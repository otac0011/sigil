// Generation task dispatcher, shared by the module worker and the main-thread fallback. No three.

import { createLayout } from './layout.js';
import { buildFarSector, buildNearChunk, buildGroundSector } from './mesh-build.js';
import { buildLandmark } from './landmark-shapes.js';
import { hashBuffers } from '../math/rng.js';

const geomBuffers = (g) => [g.position.buffer, g.color.buffer, g.win.buffer];

export function createTaskHandler() {
  let layout = null;
  return function handle(msg) {
    switch (msg.type) {
      case 'init':
        layout = createLayout(msg.data, { farT: msg.farT });
        return { result: { ok: true }, transfer: [] };
      case 'far': {
        const res = buildFarSector(layout, msg.sector);
        return { result: res, transfer: [res.matrices.buffer, res.colors.buffer, res.chunks.buffer] };
      }
      case 'near': {
        const res = buildNearChunk(layout, msg.i, msg.j);
        return { result: res, transfer: geomBuffers(res) };
      }
      case 'ground': {
        const res = buildGroundSector(layout, msg.sector, msg.sectors, msg.segU, msg.segV);
        return { result: res, transfer: geomBuffers(res) };
      }
      case 'landmarks': {
        const list = layout.landmarks.map((lm) => buildLandmark(layout, lm));
        return { result: list, transfer: list.flatMap((g) => [...geomBuffers(g), g.emitters.buffer]) };
      }
      case 'hash': {
        const near = buildNearChunk(layout, msg.i, msg.j), far = buildFarSector(layout, msg.i);
        return { result: { near: hashBuffers(near.position, near.color, near.win), far: hashBuffers(far.matrices, far.colors, far.chunks) }, transfer: [] };
      }
      default:
        throw new Error(`unknown task ${msg.type}`);
    }
  };
}
