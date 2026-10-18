import { invoke } from "@tauri-apps/api/core";

export type Device = { id: string; name: string };
export type Devices = { cameras: Device[]; microphones: Device[] };

export const listDevices = () => invoke<Devices>("list_devices");
