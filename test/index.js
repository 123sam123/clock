// Entry point for `node --test test/`: Node 24 runs a bare directory argument
// as an entry module instead of expanding it, so the directory must resolve
// here. Import every test file in this folder.
import './timer.test.mjs';
import './chime.test.mjs';
import './notify.test.mjs';
import './completion.test.mjs';
import './session.test.mjs';
