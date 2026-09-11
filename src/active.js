// Skylark Run — the aircraft currently being flown.
//
// A one-field box so that shared code can reach the active craft without
// importing one. damage.js is the reason it exists: the death spiral has to
// keep the scenery scrolling and know where the ground is, and it used to get
// both by importing the plane's world — which dragged the plane's *sky* into
// the city and lit a night scene with a daylight hemisphere.
//
// Set by main.js when a craft is chosen; read, never written, everywhere else.
export const Active = { craft: null };
