// Skylark Run — the full-screen overlays.
//
// Every screen in the game is one of these divs; show() raises exactly one and
// hideAll() drops them all so the flight is visible. Kept apart from the flow
// so that anything ending a run can reach for a screen without pulling the
// whole menu system in behind it.

const overlays=["craftOverlay","startOverlay","pauseOverlay","overOverlay","rotateOverlay","clearOverlay","quitOverlay"];

function show(id){overlays.forEach(o=>document.getElementById(o).classList.toggle("hidden",o!==id));}
function hideAll(){overlays.forEach(o=>document.getElementById(o).classList.add("hidden"));}

export { overlays, show, hideAll };
