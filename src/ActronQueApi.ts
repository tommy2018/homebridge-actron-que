import axios from 'axios';

export type ActronQueZone = {
  on: boolean;
  name: string;
  humidity: number;
  temperature: number;
  coolSetpoint: number;
  heatSetpoint: number;
  sensorId: string;
  zoneIndex: number;
}

export type ActronQueSystemInfo = {
  isOnline: boolean;
  mode: string;
  compressorMode: string;
  compressorSpeed: number;
  fanMode: string;
  quietMode: boolean;
  coolSetpoint: number;
  heatSetpoint: number;
  on: boolean;
  zones: ActronQueZone[];
  masterSensorId: string;
  temperature: number;
  humidity: number;
  model: string;
  name: string;
  limit: {
    minCool: number;
    maxCool: number;
    minHeat: number;
    maxHeat: number;
    zoneAboveMasterCool: number;
    zoneAboveMasterHeat: number;
    zoneBelowMasterCool: number;
    zoneBelowMasterHeat: number;
  }
}

export type FanMode = "LOW" | "LOW+CONT" | "MED" | "MED+CONT" | "HIGH" | "HIGH+CONT" | "AUTO" | "AUTO+CONT";
export type Mode = "COOL" | "HEAT" | "AUTO" | "FAN";

export default class ActronQue {
  public readonly signalrUrl = "wss://que.actronair.com.au/api/v0/messaging/app";

  private _refreshToken: string;
  private _serial: string;
  private _cachedToken: {
    accessToken: string;
    expiresAt: number;
  } | null = null;
  
  public constructor(refreshToken: string, serial: string) {
    this._refreshToken = refreshToken;
    this._serial = serial;
  }

  public async getSystemInfoAsync(): Promise<ActronQueSystemInfo> {
    const { data } = await axios.get(
      `https://que.actronair.com.au/api/v0/client/ac-systems/status/latest?serial=${this._serial}`,
      {
        headers: {
          "Authorization": `Bearer ${await this.getOauthToken()}`
        }
      }
    );

    const info = this.parse(data?.lastKnownState);

    return info;
  }

  public parse(data: any) {
    const zones = data?.RemoteZoneInfo
      ?.map((z, i) => ({
        ...z,
        index: i,
      }))
      ?.filter(z => z?.CanOperate === true)
      ?.map(z => ({
        on: data?.UserAirconSettings?.EnabledZones?.[z?.index],
        name: z?.NV_Title,
        humidity: z?.LiveHumidity_pc,
        temperature: z?.LiveTemp_oC,
        coolSetpoint: z?.TemperatureSetpoint_Cool_oC,
        heatSetpoint: z?.TemperatureSetpoint_Heat_oC,
        sensorId: Object.keys(z?.Sensors).join("-"),
        zoneIndex: z?.index,
      }));
    
    const info = {
      isOnline: data?.isOnline,
      zones,
      mode: data?.UserAirconSettings?.Mode,
      fanMode: data?.UserAirconSettings?.FanMode,
      quietMode: data?.UserAirconSettings?.QuietMode,
      coolSetpoint: data?.UserAirconSettings?.TemperatureSetpoint_Cool_oC,
      heatSetpoint: data?.UserAirconSettings?.TemperatureSetpoint_Heat_oC,
      on: data?.UserAirconSettings?.isOn,
      compressorMode: data?.LiveAircon?.CompressorMode,
      compressorSpeed: data?.LiveAircon?.CompressorCapacity,
      masterSensorId: data?.AirconSystem?.MasterSerial,
      model: data?.AirconSystem?.IndoorUnit?.NV_DeviceID,
      temperature: data?.MasterInfo?.LiveTemp_oC,
      humidity: data?.MasterInfo?.LiveHumidity_pc,
      name: data?.NV_SystemSettings?.SystemName,
      limit: {
        gap: data?.NV_Limits?.UserSetpoint_oC?.MinGap,
        minCool: data?.NV_Limits?.UserSetpoint_oC?.setCool_Min,
        maxCool: data?.NV_Limits?.UserSetpoint_oC?.setCool_Max,
        minHeat: data?.NV_Limits?.UserSetpoint_oC?.setHeat_Min,
        maxHeat: data?.NV_Limits?.UserSetpoint_oC?.setHeat_Max,
        zoneAboveMasterCool: Math.abs(data?.NV_Limits?.UserSetpoint_oC?.VarianceAboveMasterCool),
        zoneAboveMasterHeat: Math.abs(data?.NV_Limits?.UserSetpoint_oC?.VarianceAboveMasterHeat),
        zoneBelowMasterCool: Math.abs(data?.NV_Limits?.UserSetpoint_oC?.VarianceBelowMasterCool),
        zoneBelowMasterHeat: Math.abs(data?.NV_Limits?.UserSetpoint_oC?.VarianceBelowMasterHeat),
      }
    };

    return info;
  }

  public async setCoolSetpointAsync(temperature: number) {
    if (!Number.isInteger(temperature * 2)) {
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    await this.sendCommandAsync({
      "UserAirconSettings.TemperatureSetpoint_Cool_oC": temperature,
      "type": "set-settings"
    });
  }

  public async setHeatSetpointAsync(temperature: number) {
    if (!Number.isInteger(temperature * 2)) {
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    await this.sendCommandAsync({
      "UserAirconSettings.TemperatureSetpoint_Heat_oC": temperature,
      "type": "set-settings"
    });
  }

  public async setZoneCoolSetpointAsync(zoneIndex: number, temperature: number) {
    if (zoneIndex < 0 || zoneIndex > 7) {
      throw new Error("Zone index must be between 0 and 7");
    }

    if (!Number.isInteger(temperature * 2)) {
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    await this.sendCommandAsync({
      [`RemoteZoneInfo[${zoneIndex}].TemperatureSetpoint_Cool_oC`]: temperature,
      "type": "set-settings"
    });
  }

  public async setZoneHeatSetpointAsync(zoneIndex: number, temperature: number) {
    if (zoneIndex < 0 || zoneIndex > 7) {
      throw new Error("Zone index must be between 0 and 7");
    }

    if (!Number.isInteger(temperature * 2)) {
      throw new Error("Temperatur can only be set to half degrees or whole degrees");
    }

    await this.sendCommandAsync({
      [`RemoteZoneInfo[${zoneIndex}].TemperatureSetpoint_Heat_oC`]: temperature,
      "type": "set-settings"
    });
  }

  public async setFanModeAsync(fanMode: FanMode) {
    await this.sendCommandAsync({
      "UserAirconSettings.FanMode": fanMode,
      "type": "set-settings"
    });
  }

  public async setModeAsync(mode: Mode) {
    await this.sendCommandAsync({
      "UserAirconSettings.Mode": mode,
      "type": "set-settings"
    });
  }

  public async setQuietModeAsync(on: boolean) {
    await this.sendCommandAsync({
      "UserAirconSettings.QuietMode": on,
      "type": "set-settings"
    });
  }

  public async setIsOnAsync(on: boolean) {
    await this.sendCommandAsync({
      "UserAirconSettings.isOn": on,
      "type": "set-settings"
    });
  }

  public async setZonesEnabledAsync(zonesEnabled: boolean[]) {
    if (zonesEnabled.length !== 8) {
      throw new Error("zonesEnabled must be an array of length 8");
    }

    await this.sendCommandAsync({
      "UserAirconSettings.EnabledZones": zonesEnabled,
      "type": "set-settings"
    });
  }

  public async setZoneEnabledAsync(zoneIndex: number, enabled: boolean) {
    if (zoneIndex < 0 || zoneIndex > 7) {
      throw new Error("ZoneIndex must be between 0 and 7");
    }

    await this.sendCommandAsync({
      [`UserAirconSettings.EnabledZones[${zoneIndex}]`]: enabled,
      "type": "set-settings"
    });
  }

  public async negotiateSignalrConnectionAsync() {
    const { data } = await axios.get(
      `https://que.actronair.com.au/api/v0/messaging/app/negotiate`,
      {
        headers: {
          "Authorization": `Bearer ${await this.getOauthToken()}`,
        }
      }
    );

    return {
      connectionToken: encodeURIComponent(data?.ConnectionToken),
      protocolVersion: data?.ProtocolVersion,
    };
  }

  private async sendCommandAsync(command: object) {
    await axios.post(
      `https://que.actronair.com.au/api/v0/client/ac-systems/cmds/send?serial=${this._serial}`,
      { command: command },
      {
        headers: {
          "Authorization": `Bearer ${await this.getOauthToken()}`,
          "Content-Type": "application/json",
        }
      }
    );
  }

  public async getOauthToken() {
    if (this._cachedToken && this._cachedToken.expiresAt > Date.now()) {
      return this._cachedToken.accessToken;
    }

    const formData = new URLSearchParams();
    
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', this._refreshToken);
    formData.append('client_id', 'app');

    const { data: tokenResponse } = await axios.post(
      'https://que.actronair.com.au/api/v0/oauth/token',
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      }
    );

    this._cachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + ((tokenResponse.expires_in - 1800) * 1000),
    };

    return this._cachedToken.accessToken;
  }
}
