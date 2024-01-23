import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ActronQuePlatform } from './platform';
import { AirConState, ZoneState } from './types';

export class ZoneAccessory {
  private service: Service;
  private zoneState: ZoneState;
  private airConState: AirConState;

  constructor(
    private readonly platform: ActronQuePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly zoneIndex: number,
  ) {
    this.zoneState = this.platform.zones[zoneIndex];
    this.airConState = this.platform.airCon!;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ActronAir')
      .setCharacteristic(this.platform.Characteristic.Model, 'Que Zone')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.zoneState.sensorId);

    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.platform.on("deviceStateUpdated", () => this.updateDeviceCharacteristics());
  }

  public updateDeviceCharacteristics() {
    this.platform.log.info("Updating zone", this.zoneIndex, "characteristics");

    this.airConState = this.platform.airCon!;
    this.zoneState = this.platform.zones[this.zoneIndex];

    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentHeatingCoolingState());
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.getTargetHeatingCoolingState());
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.getTargetTemperature());
  }

  private async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();

    if (airConInfo.isOnline === false) {
      this.platform.log.error("AirCon is offline");
      throw new Error("AirCon is offline");
    }

    const airConState = this.platform.parseAirCon(airConInfo);
    const zonesState = this.platform.parseZones(airConInfo.zones);


    if (value == this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      this.platform.log.info("Turning off zone", zonesState[this.zoneIndex].name);
      await this.platform.actronQueApi.setZoneEnabledAsync(this.zoneIndex, false);

      // update cached state
      this.zoneState.on = false;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentHeatingCoolingState());
    } else if (value == this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      if (airConState.operationMode === "COOL") {
        this.platform.log.error("Setting zone to heat mode when master is in cool mode is not allowed");
        throw new Error("Setting zone to heat mode when master is in cool mode is not allowed");
      }

      this.platform.log.info("Turning on zone", zonesState[this.zoneIndex].name);
      await this.platform.actronQueApi.setZoneEnabledAsync(this.zoneIndex, true);
      
      // update cached state
      this.zoneState.on = true;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentHeatingCoolingState());
    } else if (value == this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
      if (airConState.operationMode === "HEAT") {
        this.platform.log.error("Setting zone to cool mode when master is in heat mode is not allowed");
        throw new Error("Setting zone to cool mode when master is in heat mode is not allowed");
      }

      this.platform.log.info("Turning on zone", zonesState[this.zoneIndex].name);
      await this.platform.actronQueApi.setZoneEnabledAsync(this.zoneIndex, true);

      // update cached state
      this.zoneState.on = true;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentHeatingCoolingState());
    } else {
      this.platform.log.error("Unsupported value", value);
      throw new Error("Unsupported value");
    }
  }

  private async setTargetTemperature(value: CharacteristicValue) {
    if (!Number.isInteger(value as number * 2)) {
      this.platform.log.error("Temperatur can only be set to half degrees or whole degrees");
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();

    if (airConInfo.isOnline === false) {
      this.platform.log.error("AirCon is offline");
      throw new Error("AirCon is offline");
    }

    const airConState = this.platform.parseAirCon(airConInfo);

    if (airConState.operationMode === "COOL") {
      this.platform.log.info("Setting zone cool setpoint to", value);

      const masterSetpont = airConState.coolSetpoint;

      // check global limit
      if ((value as number) < airConState.limit.minCool || (value as number) > airConState.limit.maxCool) {
        this.platform.log.error("Setting zone cool setpoint to", value, "is outside of limit", airConState.limit.minCool, "-", airConState.limit.maxCool);
        throw new Error("Setting zone cool setpoint to outside of limit");
      }

      // check zone limit
      if (
          value as number > masterSetpont + (airConState.limit.zoneAboveMasterCool ?? 2) ||
          value as number < masterSetpont - (airConState.limit.zoneBelowMasterCool ?? 2)
      ) {
        this.platform.log.error("Setting zone cool setpoint to", value, "is more than", airConState.limit.zoneAboveMasterCool ?? 2, "degrees above or", airConState.limit.zoneBelowMasterCool ?? 2, "degrees below master setpoint", masterSetpont);
        throw new Error("Setting zone cool setpoint to more than 2 degrees above or below master setpoint");
      }

      await this.platform.actronQueApi.setZoneCoolSetpointAsync(this.zoneIndex, value as number);

      // update cached state
      this.zoneState.targetTemperature = value as number;
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.getTargetTemperature());
    } else if (airConState.operationMode === "HEAT") {
      this.platform.log.info("Setting zone heat setpoint to", value);

      const masterSetpont = airConState.heatSetpoint;

      // check global limit
      if ((value as number) < airConState.limit.minHeat || (value as number) > airConState.limit.maxHeat) {
        this.platform.log.error("Setting zone heat setpoint to", value, "is outside of limit", airConState.limit.minHeat, "-", airConState.limit.maxHeat);
        throw new Error("Setting zone heat setpoint to outside of limit");
      }

      // check zone limit
      if (
          value as number > masterSetpont + (airConState.limit.zoneAboveMasterHeat ?? 2) ||
          value as number < masterSetpont - (airConState.limit.zoneBelowMasterHeat ?? 2)
      ) {
        this.platform.log.error("Setting zone heat setpoint to", value, "is more than", airConState.limit.zoneAboveMasterHeat ?? 2, "degrees above or", airConState.limit.zoneBelowMasterHeat ?? 2, "degrees below master setpoint", masterSetpont);
        throw new Error("Setting zone heat setpoint to more than 2 degrees above or below master setpoint");
      }

      await this.platform.actronQueApi.setZoneHeatSetpointAsync(this.zoneIndex, value as number);

      // update cached state
      this.zoneState.targetTemperature = value as number;
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.getTargetTemperature());
    } else {
      this.platform.log.error("Not implemented");
      throw new Error("Not implemented");
    }
  }

  private getTargetTemperature(): CharacteristicValue  {
    return this.zoneState.targetTemperature;
  }

  private getCurrentTemperature(): CharacteristicValue  {
    return this.zoneState.currentTemperature;
  }

  private getTargetHeatingCoolingState(): CharacteristicValue  {
    if (!this.zoneState.on) {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    } else if (this.airConState.operationMode === "COOL") {
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else if (this.airConState.operationMode === "HEAT") {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (this.airConState.operationMode === "AUTO") {
    return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  } 

  private getCurrentHeatingCoolingState(): CharacteristicValue  {
    if (this.airConState.compressorMode === "COOL") {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    } else if (this.airConState.compressorMode === "HEAT") {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  } 
}
