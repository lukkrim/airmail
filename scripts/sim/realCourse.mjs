// Node helper: build real-land courses for the headless checks (PNG decoding
// with pngjs, since Node has no canvas).
import { PNG } from 'pngjs';
import { setPngDecoder } from '../../src/environment/tiles.js';
import { buildCourse } from '../../src/environment/courseBuild.js';
import { makeGround } from '../../src/environment/course.js';

setPngDecoder((buf) => PNG.sync.read(Buffer.from(buf)).data);

export async function nodeGround(opts) {
  return makeGround(await buildCourse(opts));
}
