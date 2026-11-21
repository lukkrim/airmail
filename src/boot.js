// Starts the game. With ?ground=… in the address (a preset name such as
// bigsur, fjord, alps, lakes, or lat,lon,bearing), the real land there is
// loaded first and replaces the practice valley. If it can't load, the
// practice valley is used.
import { setGround } from './environment/world.js';
import { groundFromURL, loadRealGround } from './environment/course.js';

const want = groundFromURL(location.search);
const ready = want
  ? loadRealGround(want)
    .then((g) => { setGround(g); console.info('Real ground:', g.info); })
    .catch((err) => console.warn('Real ground not loaded; using the practice valley.', err))
  : Promise.resolve();
ready.then(() => import('./main.js'));
