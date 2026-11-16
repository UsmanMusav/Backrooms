import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_HEIGHT, seededRandom } from './level';
import { labelTexture } from './textures';
import { createWallOutlet } from './props';
import { debrisPaperAtlas } from './materials';

/** Small batched details and baked contact shading, affordable on the PS3-like low preset. */
export function enrichEnvironment(scene: THREE.Scene, map: boolean[][]) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const ctx = c.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, 'rgba(18,23,11,.6)'); gradient.addColorStop(.25, 'rgba(18,23,11,.24)'); gradient.addColorStop(1, 'rgba(18,23,11,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 16, 128);
  const contact = new THREE.CanvasTexture(c); contact.colorSpace = THREE.SRGBColorSpace;
  const contactGeometries: THREE.BufferGeometry[] = [], paperGeometries: THREE.BufferGeometry[] = [];
  const roomWalls: { x: number; z: number; dx: number; dz: number }[] = [];
  for (let z = 1; z < map.length - 1; z++) for (let x = 1; x < map[z].length - 1; x++) {
    if (!map[z][x]) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (map[z + dz]?.[x + dx] !== false) continue;
      const geometry = new THREE.PlaneGeometry(CELL, .42);
      geometry.rotateX(-Math.PI / 2); geometry.rotateY(Math.atan2(dx, dz));
      geometry.translate(x * CELL + dx * (CELL / 2 + .21), .009, z * CELL + dz * (CELL / 2 + .21));
      contactGeometries.push(geometry); roomWalls.push({ x, z, dx, dz });
    }
  }
  const contactMesh = new THREE.Mesh(mergeGeometries(contactGeometries), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  contactMesh.name = 'WallContactShadows'; scene.add(contactMesh); contactGeometries.forEach(g => g.dispose());
  const random = seededRandom(318), darkMaterial = new THREE.MeshStandardMaterial({ color: 0x292e24, roughness: .9 });
  const outlet = createWallOutlet();
  for (let i = 0; i < roomWalls.length; i += 12) {
    const { x, z, dx, dz } = roomWalls[i], detail = outlet.clone();
    detail.position.set(x * CELL + dx * (CELL / 2 + .002), .32, z * CELL + dz * (CELL / 2 + .002)); detail.rotation.y = Math.atan2(dx, dz);
    scene.add(detail);
    if (i % 24 === 0) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(.34, .11), new THREE.MeshStandardMaterial({ map: labelTexture(`0 / ${String(100 + i).padStart(3, '0')}`, '#bfc1a1', '#47523c'), roughness: 1 }));
      plate.position.copy(detail.position).setY(1.85); plate.rotation.copy(detail.rotation); scene.add(plate);
      const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.3, 0, 0), new THREE.Vector3(-.5, -.07, .04), new THREE.Vector3(.5, -.10, .06), new THREE.Vector3(1.3, -.03, 0)]);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(cable, 12, .012, 5, false), darkMaterial); wire.position.copy(detail.position).setY(WALL_HEIGHT - .25); wire.rotation.copy(detail.rotation); scene.add(wire);
    }
  }
  // Debris sheets: four printed/handwritten designs from one atlas, each slightly crumpled.
  for (let i = 0; i < 55; i++) {
    const x = 2 + Math.floor(random() * 23), z = 2 + Math.floor(random() * 23);
    if (map[z][x]) continue;
    const g = new THREE.PlaneGeometry(.21 + random() * .02, .297, 4, 5), sheet = Math.floor(random() * 4);
    const uv = g.attributes.uv as THREE.BufferAttribute, position = g.attributes.position as THREE.BufferAttribute, crumple = random() < .3 ? .03 : .008;
    for (let v = 0; v < uv.count; v++) { uv.setX(v, (sheet + uv.getX(v)) / 4); position.setZ(v, Math.abs(Math.sin(v * 12.9898 + i) * crumple)); }
    g.computeVertexNormals(); g.rotateX(-Math.PI / 2); g.rotateY(random() * 6.28); g.translate(x * CELL + random() - .5, .006, z * CELL + random() - .5); paperGeometries.push(g);
  }
  if (paperGeometries.length) {
    const papers = new THREE.Mesh(mergeGeometries(paperGeometries), debrisPaperAtlas());
    papers.receiveShadow = true; scene.add(papers); paperGeometries.forEach(g => g.dispose());
  }
}
