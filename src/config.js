// Skylark Run — the flight envelope.
//
// These are the numbers that make the aircraft feel like an aeroplane rather
// than a helicopter: how fast she runs, how hard she turns, how much air she
// needs under the wheels. When the helicopter arrives this file becomes the
// plane's half of a Craft, and the rotorcraft gets its own set — the constant
// *names* are already the same in both games, only the values differ.

export const LAT_CLAMP = 560;   // how far off the course line you may wander
export const VIEW = 2700;       // spawn horizon ahead of the aircraft
export const SPEED0 = 62, SPEED_MAX = 136, SPEED_RAMP = 0.5;
export const MAX_VX = 96, MAX_VY = 58;
export const MAX_Y = 330;       // cloud base — climb past it and you are blind
export const PR = 8;            // aircraft collision radius
export const MIN_CLEAR = 7;     // metres of air you need under the wheels
export const CANOPY_H = 17;     // treetop height inside woodland
