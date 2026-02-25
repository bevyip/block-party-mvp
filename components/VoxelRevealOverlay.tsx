import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { PegGrid } from "../utils/litebrite/types";
import { LITEBRITE_PALETTE } from "../utils/litebrite/constants";
import { setVoxelPreviewActive } from "../utils/audio";

interface VoxelRevealOverlayProps {
  frontGrid: PegGrid;
  sideGrid: PegGrid;
  onComplete: () => void;
}

/** Resolve a grid cell (hex string or palette code) to hex color. */
function cellToHex(cell: string | null): string | null {
  if (!cell || cell === "transparent") return null;
  if (cell.startsWith("#")) return cell;
  return LITEBRITE_PALETTE[cell]?.hex ?? "#ffffff";
}

function createVoxels(
  frontGrid: PegGrid,
  sideGrid: PegGrid,
): { x: number; y: number; z: number; color: string }[] {
  const voxels: { x: number; y: number; z: number; color: string }[] = [];
  const map = new Map<string, boolean>();

  const addVoxel = (x: number, y: number, z: number, color: string) => {
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    if (map.has(key)) return;
    map.set(key, true);
    voxels.push({
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z),
      color,
    });
  };

  const rows = frontGrid.length;
  const cols = frontGrid[0]?.length ?? 0;
  const offsetX = cols / 2;
  const offsetY = rows / 2;

  // Determine depth from side grid width — minimum 3 so nothing is paper-thin
  const sideWidth = sideGrid[0]?.length ?? 0;
  const depth = Math.max(3, Math.min(sideWidth, 6));

  // Build a per-row depth map from side grid
  // Each row of the side grid tells us how wide (deep) that row is
  const rowDepth: number[] = [];
  for (let row = 0; row < rows; row++) {
    const sideRow = sideGrid[row];
    if (!sideRow) {
      rowDepth.push(depth);
      continue;
    }
    // Count non-null cells in this side row
    const filledCols = sideRow.filter(
      (cell) => cellToHex(cell ?? null) !== null,
    ).length;
    rowDepth.push(Math.max(3, filledCols > 0 ? filledCols : depth));
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = frontGrid[row]?.[col];
      const hex = cellToHex(cell ?? null);
      if (!hex) continue;

      const gx = col - offsetX;
      const gy = -row + offsetY;
      const d = rowDepth[row];

      // Front face
      addVoxel(gx, gy, 0, hex);

      // Extrude backward — fill the full depth envelope
      // Use side grid color if available, otherwise use front color
      for (let z = 1; z <= d; z++) {
        const sideCell = sideGrid[row]?.[z - 1];
        const sideHex = cellToHex(sideCell ?? null) ?? hex;
        addVoxel(gx, gy, -z, sideHex);
      }
    }
  }

  return voxels;
}

type SimVoxel = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: THREE.Color;
};

const VOXEL_SIZE = 1.0; // fills full grid cell — no gap
const SCENE_SCALE = 0.95; // just enough breathing room at edges

export function VoxelRevealOverlay({
  frontGrid,
  sideGrid,
  onComplete,
}: VoxelRevealOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const phaseRef = useRef<"rotating" | "launching">("rotating");
  const phaseTimerRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    setVoxelPreviewActive(true);

    const loadingAudio = new Audio("/sounds/voxel-loading.mp3");
    loadingAudio.loop = true;
    loadingAudio.volume = 0.6;
    loadingAudio.play().catch(() => {});

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1c1c2e");
    // scene.fog = new THREE.FogExp2("#1c1c2e", 0.04);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );
    // Camera distance set after simVoxels (see below)

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(new THREE.Color("#1c1c2e"), 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    container.appendChild(renderer.domElement);

    // Six-axis uniform lighting — one directional from each face direction
    // Directional lights have NO distance falloff so all voxel layers
    // get identical brightness regardless of z-depth
    const lightIntensity = 1.2;
    const lightColor = 0xffffff;

    [
      [0, 0, 1], // front
      [0, 0, -1], // back
      [1, 0, 0], // right
      [-1, 0, 0], // left
      [0, 1, 0], // top
      [0, -1, 0], // bottom
    ].forEach(([x, y, z]) => {
      const light = new THREE.DirectionalLight(lightColor, lightIntensity);
      light.position.set(x * 20, y * 20, z * 20);
      scene.add(light);
    });

    // Small ambient lift to prevent any remaining dark spots
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const rawVoxels = createVoxels(frontGrid, sideGrid);
    const simVoxels: SimVoxel[] = rawVoxels.map((v) => ({
      x: v.x * SCENE_SCALE,
      y: v.y * SCENE_SCALE,
      z: v.z * SCENE_SCALE,
      vx: 0,
      vy: 0,
      vz: 0,
      color: new THREE.Color(v.color),
    }));

    // Compute bounding box of all voxels
    const bbox = new THREE.Box3();
    simVoxels.forEach((v) =>
      bbox.expandByPoint(new THREE.Vector3(v.x, v.y, v.z)),
    );
    const bsize = new THREE.Vector3();
    bbox.getSize(bsize);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Camera distance: fit the largest dimension in view with padding
    const maxDim = Math.max(bsize.x, bsize.y, bsize.z);
    const fovRad = (camera.fov * Math.PI) / 180;
    const fitDist = maxDim / 2 / Math.tan(fovRad / 2);
    camera.position.set(0, 0, fitDist * 2.5); // further back so preview is not as large
    camera.updateProjectionMatrix();

    const geometry = new THREE.BoxGeometry(
      VOXEL_SIZE * SCENE_SCALE,
      VOXEL_SIZE * SCENE_SCALE,
      VOXEL_SIZE * SCENE_SCALE,
    );
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, simVoxels.length);
    mesh.castShadow = true;

    const group = new THREE.Group();
    scene.add(group);
    group.add(mesh);
    // Center the group on the bbox center so it's never off-screen
    group.position.set(-center.x, -center.y, -center.z);

    const edgePositions: THREE.LineSegments[] = [];
    let edgesGeo: THREE.EdgesGeometry | null = null;
    let edgesMat: THREE.LineBasicMaterial | null = null;

    if (true) {
      const EDGE_SCALE = 1.02; // 2% larger than cube — sits just outside face
      edgesGeo = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          VOXEL_SIZE * SCENE_SCALE * EDGE_SCALE,
          VOXEL_SIZE * SCENE_SCALE * EDGE_SCALE,
          VOXEL_SIZE * SCENE_SCALE * EDGE_SCALE,
        ),
      );
      edgesMat = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthTest: true,
        depthWrite: false,
      });
      simVoxels.forEach((v) => {
        const ls = new THREE.LineSegments(edgesGeo!, edgesMat!);
        ls.position.set(v.x, v.y, v.z);
        group.add(ls);
        edgePositions.push(ls);
      });
    }

    const dummy = new THREE.Object3D();

    const draw = () => {
      simVoxels.forEach((v, i) => {
        dummy.position.set(v.x, v.y, v.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, v.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    const updatePhysics = (deltaMs: number) => {
      if (phaseRef.current === "launching") {
        simVoxels.forEach((v) => {
          v.x += v.vx;
          v.y += v.vy;
          v.z += v.vz;
          v.vy += 0.02;
        });
      }
    };

    draw();

    let rotY = 0;
    const LAUNCH_AT_RAD = 2 * Math.PI; // exactly one full 360° rotation
    const ROT_SPEED = 0.008;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      const now = Date.now();

      if (phaseRef.current === "rotating") {
        rotY += ROT_SPEED;
        group.rotation.y = rotY;

        // Launch after exactly one full 360° rotation — radian-based, not time-based
        if (rotY >= LAUNCH_AT_RAD) {
          loadingAudio.pause();
          loadingAudio.currentTime = 0;
          phaseRef.current = "launching";
          phaseTimerRef.current = now;

          simVoxels.forEach((v) => {
            v.vy = 0.16 + Math.random() * 0.12;
            v.vx = (Math.random() - 0.5) * 0.06;
            v.vz = (Math.random() - 0.5) * 0.06;
          });
        }
      } else if (phaseRef.current === "launching") {
        const elapsed = now - phaseTimerRef.current;

        simVoxels.forEach((v) => {
          v.x += v.vx;
          v.y += v.vy;
          v.z += v.vz;
          v.vy += 0.005; // slower disassembly as they shoot up
        });

        edgePositions.forEach((ls, i) => {
          const v = simVoxels[i];
          if (v) ls.position.set(v.x, v.y, v.z);
        });

        draw();

        // Fade once most voxels have left view, then switch to map quickly
        if (elapsed > 2000) {
          if (overlayRef.current) {
            overlayRef.current.style.transition = "opacity 0.2s ease-out";
            overlayRef.current.style.opacity = "0";
          }
          setTimeout(() => onComplete(), 200);
          return;
        }
      }

      draw();
      renderer.render(scene, camera);
    };

    animate();

    const dismantle = () => {
      setVoxelPreviewActive(false);
      loadingAudio.pause();
      loadingAudio.currentTime = 0;
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (edgesGeo && edgesMat) {
        edgesGeo.dispose();
        edgesMat.dispose();
        edgePositions.forEach((ls) => group.remove(ls));
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };

    return dismantle;
  }, [frontGrid, sideGrid, onComplete]);

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#1c1c2e",
      }}
    >
      {/* Three.js canvas — fills everything */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Text overlay — bottom center */}
      <p
        style={{
          position: "absolute",
          bottom: "8%",
          width: "100%",
          textAlign: "center",
          color: "rgba(255,255,255,0.6)",
          fontFamily: "monospace",
          fontSize: "0.85rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          pointerEvents: "none",
          margin: 0,
        }}
      >
        Joining the party...
      </p>
    </div>
  );
}
