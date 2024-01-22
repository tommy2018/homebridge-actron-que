import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ActronQuePlatform } from './platform';
import { AirConState } from './types';

export class MasterControllerAccessory {
  private service: Service;
  private airConState: AirConState;

  constructor(
    private readonly platform: ActronQuePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.airConState = this.platform.airCon!;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ActronAir')
      .setCharacteristic(this.platform.Characteristic.Model, this.airConState.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.airConState.masterSensorId);

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentHumidity.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .onSet(this.setHeatingThresholdTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));

    this.platform.on("deviceStateUpdated", () => this.updateDeviceCharacteristics());
  }

  private updateDeviceCharacteristics() {
    this.platform.log.info("Updating master controller characteristics");
    
    this.airConState = this.platform.airCon!;
  
    this.service.updateCharacteristic(this.platform.Characteristic.Active, this.getActive());
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.getCurrentHeaterCoolerState());
    this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, this.getTargetHeaterCoolerState());
    this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.getCoolingThresholdTemperature());
    this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.getHeatingThresholdTemperature());
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getRotationSpeed());
  }

  private async setActive(value: CharacteristicValue) {
    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();
    const airConState = this.platform.parseAirCon(airConInfo);

    if (value === this.platform.Characteristic.Active.ACTIVE && !airConState.on) {
      this.platform.log.info("Setting power to on");
      await this.platform.actronQueApi.setIsOnAsync(true);
    } else if (value === this.platform.Characteristic.Active.INACTIVE && airConState.on) {
      this.platform.log.info("Setting power to off");
      await this.platform.actronQueApi.setIsOnAsync(false);
    }
  }

  private async setTargetHeaterCoolerState(value: CharacteristicValue) {
    if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      await this.platform.actronQueApi.setModeAsync("COOL");
      this.platform.log.info("Setting mode to COOL");
    } else if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      await this.platform.actronQueApi.setModeAsync("HEAT");
      this.platform.log.info("Setting mode to HEAT");
    } else if (value === this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
      this.platform.log.error("AUTO mode is not supported");
      throw new Error("AUTO mode is not supported");
    }
  }

  private async setRotationSpeed(value: CharacteristicValue) {
    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();
    const airConState = this.platform.parseAirCon(airConInfo);
    const isCoolMode = (airConState.operationMode === "COOL");

    if (value as number <= 30) {
      await this.platform.actronQueApi.setFanModeAsync(isCoolMode ? "LOW+CONT" : "LOW");
      this.platform.log.info(`Setting fan mode to LOW. Input value:  ${value}`);
    } else if (value as number <= 60) {
      await this.platform.actronQueApi.setFanModeAsync(isCoolMode ? "MED+CONT" : "MED");
      this.platform.log.info(`Setting fan mode to MED. Input value:  ${value}`);
    } else if (value as number <= 90) {
      await this.platform.actronQueApi.setFanModeAsync(isCoolMode ? "HIGH+CONT" : "HIGH");
      this.platform.log.info(`Setting fan mode to HIGH. Input value:  ${value}`);
    } else if (value as number <= 100) {
      await this.platform.actronQueApi.setFanModeAsync(isCoolMode ? "AUTO+CONT" : "AUTO");
      this.platform.log.info(`Setting fan mode to AUTO. Input value:  ${value}`);
    }
  }

  private async setCoolingThresholdTemperature(value: CharacteristicValue) {
    if (!Number.isInteger(value as number * 2)) {
      this.platform.log.error("Temperatur can only be set to half degrees or whole degrees");
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();
    const airConState = this.platform.parseAirCon(airConInfo);

    if ((value as number) < airConState.limit.minCool || (value as number) > airConState.limit.maxCool) {
      this.platform.log.error("Setting master cool setpoint to", value, "is outside of limit", airConState.limit.minCool, "-", airConState.limit.maxCool);
      throw new Error("Setting master cool setpoint to outside of limit");
    }

    this.platform.log.info(`Setting cooling setpoint to ${value}`);
    await this.platform.actronQueApi.setCoolSetpointAsync(value as number);
  }

  private async setHeatingThresholdTemperature(value: CharacteristicValue) {
    if (!Number.isInteger(value as number * 2)) {
      this.platform.log.error("Temperatur can only be set to half degrees or whole degrees");
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();
    const airConState = this.platform.parseAirCon(airConInfo);
    
    if ((value as number) < airConState.limit.minHeat || (value as number) > airConState.limit.maxHeat) {
      this.platform.log.error("Setting master heat setpoint to", value, "is outside of limit", airConState.limit.minHeat, "-", airConState.limit.maxHeat);
      throw new Error("Setting master heat setpoint to outside of limit");
    }

    this.platform.log.info(`Setting heating setpoint to ${value}`);
    await this.platform.actronQueApi.setHeatSetpointAsync(value as number);
  }

  private getRotationSpeed(): CharacteristicValue {
    switch (this.airConState.fanMode) {
      case "LOW":
      case "LOW+CONT":
        return 30;
      case "MEDIUM":
      case "MEDIUM+CONT":
        return 60;
      case "HIGH":
      case "HIGH+CONT":
        return 90;
      case "AUTO":
      case "AUTO+CONT":
      default:
        return 100;
    }
  }

  private getCoolingThresholdTemperature(): CharacteristicValue {
    return this.airConState.coolSetpoint;
  }

  private getHeatingThresholdTemperature(): CharacteristicValue {
    return this.airConState.heatSetpoint;
  }

  private getTargetHeaterCoolerState(): CharacteristicValue {
    if (this.airConState.operationMode === "COOL") {
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    } else if (this.airConState.operationMode === "HEAT") {
      return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    } else {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
  }

  private getActive(): CharacteristicValue {
    return this.airConState.on ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  private getCurrentHeaterCoolerState(): CharacteristicValue {
    if (!this.airConState.on) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    } else if (this.airConState.compressorSpeed === 0) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    } else if (this.airConState.compressorMode === "COOL") {
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    } else if (this.airConState.compressorMode === "HEAT") {
      return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    } else {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
  }

  private getCurrentTemperature(): CharacteristicValue  {
    return this.airConState.temperature;
  }

  private getCurrentHumidity(): CharacteristicValue  {
    return this.airConState.humidity;
  }
}
