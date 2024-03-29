import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import WebSocket from 'ws';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MasterControllerAccessory } from './MasterControllerAccessory';
import { ZoneAccessory } from './ZoneAccessory';
import { AirConState, ZoneState } from './types';
import ActronQueApi, { ActronQueSystemInfo, ActronQueZone } from './ActronQueApi';
import EventEmitter from 'events';
import { ConstantFanAccessory } from './ConstantFanAccessory';
import { QuietModeAccessory } from './QuietModeAccessory';

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
      this.log.info("Fetching aircon info on startup");
      await this.fetchAirConInfo();
    } catch (e) {
      this.log.error("Failed to configure accessory", e);
      return;
    }

    // master controller
    const registerMasterController = () => {
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
    };
   
    // constant fan
    const registerConstantFan = () => {
      const uuid = this.api.hap.uuid.generate("Constant Fan");
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
  
      if (existingAccessory) {
        this.log.info('Restoring existing constant fan accessory from cache:', existingAccessory.displayName);
  
        new ConstantFanAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', "Constant Fan");
  
        const accessory = new this.api.platformAccessory("Constant Fan", uuid);
  
        accessory.context.device = {
          type: "ConstantFan",
          id: "Constant Fan",
          displayName: "Constant Fan",
        };
  
        new ConstantFanAccessory(this, accessory);
  
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    };

    // quiet mode
    const registerQuietMode = () => {
      const uuid = this.api.hap.uuid.generate("Quiet Mode");
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
  
      if (existingAccessory) {
        this.log.info('Restoring existing quiet mode accessory from cache:', existingAccessory.displayName);
  
        new QuietModeAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', "Quiet Mode");
  
        const accessory = new this.api.platformAccessory("Quiet Mode", uuid);
  
        accessory.context.device = {
          type: "QuietMode",
          id: "Quiet Mode",
          displayName: "Quiet Mode",
        };
  
        new QuietModeAccessory(this, accessory);
  
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    };

    registerMasterController();
    registerConstantFan();
    registerQuietMode();

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
      fanMode: airConInfo.fanMode.replace("+CONT", ""),
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
      constantFan: airConInfo.fanMode.endsWith("+CONT"),
      quietMode: airConInfo.quietMode,
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

  public subscribeUpdate() {
    let lastUpdate = Date.now();
    let errorCount = 0;
    let watchDogTimer: NodeJS.Timeout | null = null;

    const tryUpdateStates = async () => {
      try {
        if (Date.now() - lastUpdate > 60 * 1000) {
          lastUpdate = Date.now();
          this.log.info("Pulling update manually");
          await this.updateAccessoryCharacteristics();
        }
      } catch {}
    };

    const connect = async () => {
      watchDogTimer && clearTimeout(watchDogTimer);
      
      const oauthToken = await this.actronQueApi.getOauthToken();
      const signalrConnProps = await this.actronQueApi.negotiateSignalrConnectionAsync();
      const ws = new WebSocket(
        `${this.actronQueApi.signalrUrl}?transport=webSockets&connectionToken=${signalrConnProps.connectionToken}&clientProtocol=${signalrConnProps.protocolVersion}`, {
          headers: {
            "Authorization": `Bearer ${oauthToken}`
          }
      });

      let resubscribeTimer: NodeJS.Timeout | null = null;

      const watchdogAction = () => {
        watchDogTimer && clearTimeout(watchDogTimer);

        this.log.warn("No messages received from Actron Que SignalR service in 60 seconds");
        this.log.warn("Will attempt to reconnect");

        ws.close();
      };

      const errorAction = () => {
        if (errorCount++ > 10) {
          this.log.error("Failed to connect to Actron Que SignalR service after 10 attempts");
          this.log.error("Will not attempt to reconnect");
        } else {
          connect();
        }
      };

      const resubscribeAction = () => {
        if (ws.readyState === WebSocket.OPEN) {
          this.log.info("Resubscribing to Actron Que SignalR service");

          ws.send(JSON.stringify({
            command: {
              mwcSerial: this.serial,
              type:"subscribe"
            }
          }));
        } else {
          this.log.warn("Failed to resubscribe to Actron Que SignalR service as the connection is not open");
        }
      };

      ws.on('open', () => {
        this.log.info("Connected to Actron Que SignalR service");

        errorCount = 0;

        ws.send(JSON.stringify({
          command: {
            mwcSerial: this.serial,
            type:"subscribe"
          }
        }));

        resubscribeTimer = setInterval(resubscribeAction, 3800 * 1000);
      });
  
      ws.on('message', async (data) => {
        watchDogTimer && clearTimeout(watchDogTimer);

        const decodedData = data.toString();

        if (decodedData !== "{}") {
          try {
            const update = JSON.parse(decodedData);
            const airConUpdate = update?.M?.[0]?.update?.status;

            if (airConUpdate) {
              this.log.info("Received update from Actron Que SignalR service");

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

        watchDogTimer = setTimeout(watchdogAction, 60 * 1000);
      });

      ws.on('error', (e) => {
        watchDogTimer && clearTimeout(watchDogTimer);
        resubscribeTimer && clearInterval(resubscribeTimer);

        this.log.error('Error connecting to Actron Que SignalR service', e);
        this.log.warn("Will attempt to reconnect in 30 seconds");

        // reconnect up to 10 times, 60 seconds apart, then give up
        setTimeout(errorAction, 60 * 1000);
      });
      
      ws.on('close', () => {
        watchDogTimer && clearTimeout(watchDogTimer);
        resubscribeTimer && clearInterval(resubscribeTimer);

        this.log.warn("Disconnected from Actron Que SignalR service");
        this.log.warn("Will attempt to reconnect in 30 seconds");

        // reconnect in 30 seconds
        setTimeout(connect, 30 * 1000);
      });
    }

    setInterval(tryUpdateStates, 20 * 1000);
    connect();
  }

  private async updateAccessoryCharacteristics() {
    await this.fetchAirConInfo();
    this.emit("deviceStateUpdated");
  }
}
