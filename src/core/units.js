// Distances in the player's chosen unit. Everything is stored in km.
import { settings } from './settings.js';

const KM_PER_MI = 1.609344;

export const unit = () => settings.units;                 // 'km' or 'mi'
export const toUnit = (km) => (settings.units === 'mi' ? km / KM_PER_MI : km);
export const num = (km) => Math.round(toUnit(km)).toLocaleString('en-US');

// "1,234 km" / "767 mi"
export const dist = (km) => `${num(km)} ${settings.units}`;
