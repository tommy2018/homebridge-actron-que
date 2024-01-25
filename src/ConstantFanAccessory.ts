import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ActronQuePlatform } from './platform';
import { AirConState } from './types';

export class ConstantFanAccessory {
    private service: Service;
    private airConState: AirConState;

    constructor(
        private readonly platform: ActronQuePlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.airConState = this.platform.airCon!;

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ActronAir')
        .setCharacteristic(this.platform.Characteristic.Model, "Constant Mode Switch")
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.airConState.masterSensorId);

        this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

        this.service.getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getOn.bind(this))
        .onSet(this.setOn.bind(this));

        this.platform.on("deviceStateUpdated", () => this.updateDeviceCharacteristics());
    }

    private updateDeviceCharacteristics() {
        this.platform.log.info("Updating constant fan switch characteristics");
        
        this.airConState = this.platform.airCon!;

        this.service.updateCharacteristic(this.platform.Characteristic.On, this.getOn());
    }

    private async setOn(value: CharacteristicValue) {
        const airConInfo = await this.platform.actronQueApi.getSystemInfoAsync();

        if (airConInfo.isOnline === false) {
            this.platform.log.error("AirCon is offline");
            throw new Error("AirCon is offline");
        }

        const airConState = this.platform.parseAirCon(airConInfo);

        if (value === true) {
            this.platform.log.info("Setting constant fan mode to on");
        } else {
            this.platform.log.info("Setting constant fan mode to off");
        }

        switch (airConState.fanMode) {
            case "LOW":
                await this.platform.actronQueApi.setFanModeAsync(value === true ? "LOW+CONT" : "LOW");
                break;
            case "MED":
                await this.platform.actronQueApi.setFanModeAsync(value === true ? "MED+CONT" : "MED");
                break;
            case "HIGH":
                await this.platform.actronQueApi.setFanModeAsync(value === true ? "HIGH+CONT" : "HIGH");
                break;
            case "AUTO":
                await this.platform.actronQueApi.setFanModeAsync(value === true ? "AUTO+CONT" : "AUTO");
                break;
        }

        this.airConState.constantFan = value === true;
        this.service.updateCharacteristic(this.platform.Characteristic.Active, this.getOn());
    }

    private getOn(): CharacteristicValue {
        return this.airConState.constantFan === true;
    }
}
