import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import WebSocket from 'ws';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MasterControllerAccessory } from './MasterControllerAccessory';
import { ZoneAccessory } from './ZoneAccessory';
import { AirConState, ZoneState } from './types';
import ActronQueApi, { ActronQueSystemInfo, ActronQueZone } from './ActronQueApi';
import EventEmitter from 'events';

export class ActronQuePlatform extends EventEmitter implements DynamicPlatformPlugin  {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  public readonly actronQueApi: ActronQueApi;

  public zones: Record<number, ZoneState> = {};
  public airCon: AirConState | null = null;

  private readonly serial: string;
  private readonly refreshToken: string;
  
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    super();

    this.serial = config['serial'] ?? "";
    this.refreshToken = config['refreshToken'] ?? "";

    if (!this.serial || !this.refreshToken) {
      this.log.error("Missing required configuration parameters");
      throw new Error("Missing required configuration parameters");
    }

    this.actronQueApi = new ActronQueApi(this.refreshToken, this.serial);

    this.log.debug('Finished initializing platform: Actron Que');

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private async discoverDevices() {
    try {
      await this.fetchAirConInfo();
    } catch (e) {
      this.log.error("Failed to configure accessory", e);
      return;
    }

    // master controller
    const uuid = this.api.hap.uuid.generate("Master Controller");
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing master controller accessory from cache:', existingAccessory.displayName);

      new MasterControllerAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', "Master Controller");

      const accessory = new this.api.platformAccessory("Master Controller", uuid);

      accessory.context.device = {
        type: "MasterController",
        id: "Master Controller",
        displayName: this.airCon!.name,
      };

      new MasterControllerAccessory(this, accessory);

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // zones
    for (const zoneIndex in this.zones) {
      const uuid = this.api.hap.uuid.generate(`Zone-${zoneIndex}`);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing zone accessory from cache:', existingAccessory.displayName);

        new ZoneAccessory(this, existingAccessory, Number(zoneIndex))
      } else {
        this.log.info('Adding new accessory:', `Zone-${zoneIndex}`);

        const accessory = new this.api.platformAccessory(this.zones[zoneIndex].name, uuid);

        accessory.context.device = {
          type: "Zone",
          id: `Zone-${zoneIndex}`,
          displayName: `${this.zones[zoneIndex].name} Zone`,
        };

        new ZoneAccessory(this, accessory, Number(zoneIndex));

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    this.subscribeUpdate();
  }

  private async fetchAirConInfo() {
    const airConInfo = await this.actronQueApi.getSystemInfoAsync();

    this.airCon = this.parseAirCon(airConInfo);
    this.zones = this.parseZones(airConInfo.zones);
  }

  public parseAirCon(airConInfo: ActronQueSystemInfo): AirConState {
    return {
      serialNumber: this.serial,
      operationMode: airConInfo.mode,
      fanMode: airConInfo.fanMode,
      temperature: airConInfo.temperature,
      humidity: airConInfo.humidity,
      coolSetpoint: airConInfo.coolSetpoint,
      heatSetpoint: airConInfo.heatSetpoint,
      on: airConInfo.on,
      compressorMode: airConInfo.compressorMode,
      model: airConInfo.model,
      masterSensorId: airConInfo.masterSensorId,
      compressorSpeed: airConInfo.compressorSpeed,
      name: airConInfo.name,
      limit: {
        minCool: airConInfo.limit.minCool,
        maxCool: airConInfo.limit.maxCool,
        minHeat: airConInfo.limit.minHeat,
        maxHeat: airConInfo.limit.maxHeat,
        zoneAboveMasterCool: airConInfo.limit.zoneAboveMasterCool,
        zoneAboveMasterHeat: airConInfo.limit.zoneAboveMasterHeat,
        zoneBelowMasterCool: airConInfo.limit.zoneBelowMasterCool,
        zoneBelowMasterHeat: airConInfo.limit.zoneBelowMasterHeat,
      }
    };
  }

  public parseZones(queZones: ActronQueZone[]) {
    const zones: Record<number, ZoneState> = {};

    for (const zone of queZones) {
      const zoneIndex = zone.zoneIndex;

      zones[zoneIndex] = {
        on: zone.on,
        sensorId: zone.sensorId,
        currentTemperature: zone.temperature,
        targetTemperature: zone.coolSetpoint,
        humidity: zone.humidity,
        zoneIndex: zone.zoneIndex,
        name: zone.name,
      };
    }

    return zones;
  }

  public async subscribeUpdate() {
    let lastUpdate = Date.now();
    let errorCount = 0;

    const tryUpdateStates = async () => {
      try {
        if (Date.now() - lastUpdate > 60 * 1000) {
          lastUpdate = Date.now();
          this.log.info("Pulling update manually");
          await this.updateAccessoryCharacteristics();
        }
      } catch {}
    };

    let watchdog = setInterval(tryUpdateStates, 20 * 1000);

    const connect = async () => {
      const oauthToken = await this.actronQueApi.getOauthToken();
      const signalrConnProps = await this.actronQueApi.negotiateSignalrConnectionAsync();
      const ws = new WebSocket(
        `${this.actronQueApi.signalrUrl}?transport=webSockets&connectionToken=${signalrConnProps.connectionToken}&clientProtocol=${signalrConnProps.protocolVersion}`, {
          headers: {
            "Authorization": `Bearer ${oauthToken}`
          }
      });

      ws.on('open', () => {
        this.log.info("Connected to Actron Que SignalR service");

        errorCount = 0;

        ws.send(JSON.stringify({
          command: {
            mwcSerial: this.serial,
            type:"subscribe"
          }
        }));
      });
  
      ws.on('message', async (data) => {
        const decodedData = data.toString();
        
        if (decodedData !== "{}") {
          try {
            const update = JSON.parse(decodedData);
            const airConUpdate = update?.M?.[0]?.update?.status;

            if (airConUpdate) {
              const airCon = this.actronQueApi.parse(airConUpdate);

              this.airCon = this.parseAirCon(airCon);
              this.zones = this.parseZones(airCon.zones);

              lastUpdate = Date.now();

              this.emit("deviceStateUpdated");
            }
          } catch (e) {
            this.log.error("Failed to parse message from Actron Que SignalR service", e);
          }
        }
      });

      ws.on('error', (e) => {
        this.log.error('Error connecting to Actron Que SignalR service', e);
        this.log.warn("Will attempt to reconnect in 30 seconds");

        setTimeout(async () => {
          errorCount++;

          if (errorCount > 5) {
            this.log.error("Failed to connect to Actron Que SignalR service after 5 attempts");
            this.log.error("Will not attempt to reconnect");
          } else {
            await connect();
          }
        }, 30 * 1000);
      });
      
      ws.on('close', () => {
        this.log.warn("Disconnected from Actron Que SignalR service");
        this.log.warn("Will attempt to reconnect in 30 seconds");

        setTimeout(connect, 30 * 1000);
      });
    }

    await connect();
  }

  private async updateAccessoryCharacteristics() {
    await this.fetchAirConInfo();
    this.emit("deviceStateUpdated");
  }
}
