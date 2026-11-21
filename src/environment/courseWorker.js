// Background worker: builds real-land courses off the main thread.
import { buildCourse, transfers } from './courseBuild.js';

self.onmessage = async (e) => {
  const { id, opts } = e.data;
  try {
    const course = await buildCourse(opts);
    self.postMessage({ id, ok: true, course }, transfers(course));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
