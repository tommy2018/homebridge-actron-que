export type ZoneState = {
  on: boolean;
  sensorId: string;
  currentTemperature: number;
  targetTemperature: number;
  humidity: number;
  zoneIndex: number;
  name: string;
}
  
export type AirConState = {
  serialNumber: string;
  on: boolean;
  compressorMode: string;
  operationMode: string;
  fanMode: string;
  coolSetpoint: number;
  heatSetpoint: number;
  temperature: number;
  humidity: number;
  model: string;
  masterSensorId: string;
  compressorSpeed: number;
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
};