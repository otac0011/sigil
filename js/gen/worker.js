// Module worker entry. Imports only three-free modules (import maps do not apply inside workers).
import { createTaskHandler } from './tasks.js';

const handle = createTaskHandler();

self.onmessage = (e) => {
  const { id, msg } = e.data;
  try {
    const { result, transfer } = handle(msg);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
