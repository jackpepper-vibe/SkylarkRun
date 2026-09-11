// Skylark Run — the sun, as the renderer needs to know it.
//
// Both worlds have a sun and both move it: the countryside runs a day, the city
// runs dusk to dawn. The god rays need to know where it is and how strong the
// streak should be, but must not care which world is loaded — so the direction
// and the ray strength live here, and whichever world is active writes to them.
//
// Keeping this apart from either sky is what stops the engine importing the
// plane's sky module, which used to add a daylight hemisphere to the scene
// whatever was being flown and washed the night city pale blue.
/* global THREE */

/** Unit vector from the aircraft toward the sun. Worlds set this per sector. */
export const SUNDIR = new THREE.Vector3(0.45, 0.62, -0.65).normalize();

/** How pronounced the god-ray streak is for the current time of day. */
export const Sun = { ray: 1.0 };
