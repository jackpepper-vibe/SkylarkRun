// Rotor — the flight envelope.
//
// The helicopter's half of the constants. Every name here matches the plane's
// config.js; only the values differ, which is most of what separates the two
// aircraft. MIN_Y has no counterpart on the plane: it is the hover floor that
// stops her being flown into the street.

export const FOGC = 0xc46a52;
export const AV = "#7ef0d0", AMBER = "#ffcf87", DANGER = "#ff5a4e";
export const LANES = [];   for(let i=-5;i<=5;i++) LANES.push(i*65);          // 11 lanes, +/-325 m
export const STREETS = []; for(let i=-5;i<=6;i++) STREETS.push(i*65-32.5);   // avenues between lanes
export const ROW_SPACING = 150, VIEW = 2400;
export const SPEED0 = 48, SPEED_MAX = 112, SPEED_RAMP = 0.55;
export const MAX_VX = 85, MAX_VY = 55, MIN_Y = 7, MAX_Y = 250, LAT_CLAMP = 350, PR = 9;
