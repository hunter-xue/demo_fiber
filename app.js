import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


const state = {
    planeA: true,
    planeB: true,
    route1: true,
    route2: true,
    route3: true,
    strategy: '1+1'
};

let scene;
let camera;
let renderer;
let controls;
const routes = {};
const connectPoints = { A: {}, B: {} };
// 每个平面每条路由有 TX（左→右）和 RX（右→左）两根光纤，各自独立粒子
const particleSystems = {
    A_Main_TX: [],  A_Main_RX: [],
    A_Back_TX: [],  A_Back_RX: [],
    B_Main_TX: [],  B_Main_RX: [],
    B_Back_TX: [],  B_Back_RX: [],
};

const deviceMeshes = { A: [], B: [] };
const routeWDMs = { 1: [], 2: [], 3: [] };  // 每条路由对应的波分设备 mesh

const CONFIG = {
    colors: {
        planeA: 0x00ffff,
        planeB: 0xffaa00,
        elecDev: 0xffcc00,
        optDev: 0x0088cc,
        fiberA: 0x0066aa,
        fiberB: 0xaa5500,
        broken: 0x330000,
        relay: 0xeeeeee
    }
};

function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a10, 0.001);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 140, 300);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x050a10);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    scene.add(new THREE.AmbientLight(0x404040));
    const dl = new THREE.DirectionalLight(0xffffff, 1);
    dl.position.set(30, 80, 50);
    scene.add(dl);
    const sl1 = new THREE.PointLight(0x00ffff, 0.5, 200); sl1.position.set(-120, 50, 20); scene.add(sl1);
    const sl2 = new THREE.PointLight(0xffaa00, 0.5, 200); sl2.position.set(120, 50, 20); scene.add(sl2);
    scene.add(new THREE.GridHelper(600, 60, 0x112233, 0x050a10));

    createSiteStructure();
    createRoutes();
    createParticles();

    window.addEventListener('resize', onResize);
    setStrategy(state.strategy);
    updateStatus();
    animate();
}

function createSiteStructure() {
    // --- 布局设计 ---
    // 三条路由沿 z 轴纵向分布, 每条路由对应一对波分设备(A/B平面)
    // 交换机在内侧(远离光纤), 波分设备在外侧(靠近光纤)
    // A平面(上层), B平面(下层)
    //
    //              z=-35 (北线)    z=0 (中线)    z=35 (南线)
    // [交换机A]  ─── [WDM_A] ─── [WDM_A] ─── [WDM_A] ──→ 光纤
    // [交换机B]  ─── [WDM_B] ─── [WDM_B] ─── [WDM_B] ──→ 光纤

    const yA = 22;
    const yB = 10;
    const roomY = 17;
    const routeZ = { 1: -60, 2: 0, 3: 60 };

    // 机房线框 — WebGL 不支持 linewidth>1, 用半透明体 + 亮边结合模拟厚框
    const createRoom = (x, z, w, h, d) => {
        const geo = new THREE.BoxGeometry(w, h, d);
        // 半透明填充体 (提供深度感)
        const fillMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: 0x0a2030, transparent: true, opacity: 0.25
        }));
        fillMesh.position.set(x, roomY, z);
        scene.add(fillMesh);
        // 亮色边框
        const edges = new THREE.EdgesGeometry(geo);
        const edgeMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: 0x2299bb, transparent: true, opacity: 0.85
        }));
        edgeMesh.position.set(x, roomY, z);
        scene.add(edgeMesh);
    };

    // 左站: 交换机机柜 + 三个波分机柜
    createRoom(-148, 0, 24, 28, 24);
    createRoom(-100, routeZ[1], 22, 28, 20);
    createRoom(-100, routeZ[2], 22, 28, 20);
    createRoom(-100, routeZ[3], 22, 28, 20);
    // 右站: 镜像
    createRoom(148, 0, 24, 28, 24);
    createRoom(100, routeZ[1], 22, 28, 20);
    createRoom(100, routeZ[2], 22, 28, 20);
    createRoom(100, routeZ[3], 22, 28, 20);

    // --- 交换机 (客户侧设备, 不属于光传输平面, 不受平面供电控制) ---
    const switchGeo = new THREE.BoxGeometry(12, 7, 14);
    const createSwitch = (x, y) => {
        const mesh = new THREE.Mesh(switchGeo, new THREE.MeshPhongMaterial({
            color: CONFIG.colors.elecDev, emissive: 0x332200
        }));
        mesh.position.set(x, y, 0);
        scene.add(mesh);
    };

    createSwitch(-148, yA);
    createSwitch(-148, yB);
    createSwitch(148, yA);
    createSwitch(148, yB);

    // --- 波分设备 (每站6台: 3路由 × A/B平面) ---
    const wdmGeo = new THREE.BoxGeometry(8, 5, 12);
    const createWDM = (x, y, z, plane, rid) => {
        const mesh = new THREE.Mesh(wdmGeo, new THREE.MeshPhongMaterial({
            color: CONFIG.colors.optDev, emissive: 0x001122
        }));
        mesh.position.set(x, y, z);
        scene.add(mesh);
        deviceMeshes[plane].push(mesh);
        routeWDMs[rid].push(mesh);  // 同时按路由索引
    };

    // 每条路由一对波分设备, 分布在对应 z 位置
    [1, 2, 3].forEach(rid => {
        const z = routeZ[rid];
        // 左站
        createWDM(-100, yA, z, 'A', rid);
        createWDM(-100, yB, z, 'B', rid);
        // 右站
        createWDM(100, yA, z, 'A', rid);
        createWDM(100, yB, z, 'B', rid);
    });

    // --- 每条路由独立的光纤连接点 ---
    // 每路由 4 个端口: 平面A的TX/RX口, 平面B的TX/RX口
    // TX在上(+1.5), RX在下(-1.5), 对应收发两根光纤
    const fOff = 1.5;
    [1, 2, 3].forEach(rid => {
        const z = routeZ[rid];
        connectPoints.A[rid] = {
            aTX: new THREE.Vector3(-95, yA + fOff, z),
            aRX: new THREE.Vector3(-95, yA - fOff, z),
            bTX: new THREE.Vector3(-95, yB + fOff, z),
            bRX: new THREE.Vector3(-95, yB - fOff, z),
        };
        connectPoints.B[rid] = {
            aTX: new THREE.Vector3(95, yA + fOff, z),
            aRX: new THREE.Vector3(95, yA - fOff, z),
            bTX: new THREE.Vector3(95, yB + fOff, z),
            bRX: new THREE.Vector3(95, yB - fOff, z),
        };
    });

    // --- 站内连线 (交换机 → 各波分设备, 扇出) ---
    const linkMat = new THREE.LineBasicMaterial({ color: 0x335566, opacity: 0.6, transparent: true });
    const createLink = (points) => {
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        scene.add(new THREE.Line(geo, linkMat));
    };

    [1, 2, 3].forEach(rid => {
        const z = routeZ[rid];
        // 左站扇出
        createLink([
            new THREE.Vector3(-140, yA, 0),
            new THREE.Vector3(-120, yA, z * 0.5),
            new THREE.Vector3(-104, yA, z)
        ]);
        createLink([
            new THREE.Vector3(-140, yB, 0),
            new THREE.Vector3(-120, yB, z * 0.5),
            new THREE.Vector3(-104, yB, z)
        ]);
        // 右站扇出
        createLink([
            new THREE.Vector3(140, yA, 0),
            new THREE.Vector3(120, yA, z * 0.5),
            new THREE.Vector3(104, yA, z)
        ]);
        createLink([
            new THREE.Vector3(140, yB, 0),
            new THREE.Vector3(120, yB, z * 0.5),
            new THREE.Vector3(104, yB, z)
        ]);
    });

    // --- 设备标签 ---
    addLabel(-148, yA + 16, '交换机', 16, 0, 'rgba(60,50,0,0.8)');
    addLabel(148, yA + 16, '交换机', 16, 0, 'rgba(60,50,0,0.8)');
    addLabel(-100, yA + 16, '北线 WDM', 16, routeZ[1], 'rgba(0,50,70,0.8)');
    addLabel(-100, yA + 16, '中线 WDM', 16, routeZ[2], 'rgba(0,50,70,0.8)');
    addLabel(-100, yA + 16, '南线 WDM', 16, routeZ[3], 'rgba(0,50,70,0.8)');
    addLabel(100, yA + 16, '北线 WDM', 16, routeZ[1], 'rgba(0,50,70,0.8)');
    addLabel(100, yA + 16, '中线 WDM', 16, routeZ[2], 'rgba(0,50,70,0.8)');
    addLabel(100, yA + 16, '南线 WDM', 16, routeZ[3], 'rgba(0,50,70,0.8)');
}

function createRoutes() {
    const defs = [
        { id: 1, name: '北线' },
        { id: 2, name: '中线' },
        { id: 3, name: '南线' }
    ];

    defs.forEach(def => {
        const cp = connectPoints;
        const id = def.id;
        const group = new THREE.Group();

        // dist 基于平面A TX口计算 (两站x坐标相同, 方向对称)
        const dist = cp.B[id].aTX.x - cp.A[id].aTX.x;  // 190
        const ctrlX1 = cp.A[id].aTX.x + dist * 0.3;
        const ctrlX2 = cp.A[id].aTX.x + dist * 0.7;

        const midY = 12;
        // 方向感知曲线: 根据 start→end 方向自动调整出入切线和控制点顺序
        const makeCurve = (start, end, midYVal) => {
            const goRight = end.x > start.x;
            const nudge = goRight ? 14 : -14;
            const c1x = goRight ? ctrlX1 : ctrlX2;
            const c2x = goRight ? ctrlX2 : ctrlX1;
            return new THREE.CatmullRomCurve3([
                start,
                new THREE.Vector3(start.x + nudge, start.y, start.z),
                new THREE.Vector3(c1x, midYVal, start.z),
                new THREE.Vector3(c2x, midYVal, end.z),
                new THREE.Vector3(end.x - nudge, end.y, end.z),
                end
            ]);
        };

        // 平面A/B 中段 y 偏移拉开 6 个单位，使两组中继盒有足够间距
        const curveATX = makeCurve(cp.A[id].aTX, cp.B[id].aTX, midY + 7);
        const curveARX = makeCurve(cp.B[id].aRX, cp.A[id].aRX, midY + 5);
        const curveBTX = makeCurve(cp.A[id].bTX, cp.B[id].bTX, midY - 5);
        const curveBRX = makeCurve(cp.B[id].bRX, cp.A[id].bRX, midY - 7);

        const mkMesh = (curve, color) => {
            const m = new THREE.Mesh(
                new THREE.TubeGeometry(curve, 120, 0.35, 6, false),
                new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.55 })
            );
            group.add(m);
            return m;
        };
        const meshATX = mkMesh(curveATX, CONFIG.colors.fiberA);
        const meshARX = mkMesh(curveARX, CONFIG.colors.fiberA);
        const meshBTX = mkMesh(curveBTX, CONFIG.colors.fiberB);
        const meshBRX = mkMesh(curveBRX, CONFIG.colors.fiberB);

        // 中继盒: 平面A 和平面B 各一个, 位于各自两根光纤的中点之间
        const boxGeo = new THREE.BoxGeometry(4, 5, 4);
        const boxMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.relay });
        const midA = new THREE.Vector3().lerpVectors(curveATX.getPoint(0.5), curveARX.getPoint(0.5), 0.5);
        const midB = new THREE.Vector3().lerpVectors(curveBTX.getPoint(0.5), curveBRX.getPoint(0.5), 0.5);
        const rA = new THREE.Mesh(boxGeo, boxMat.clone()); rA.position.copy(midA); group.add(rA);
        const rB = new THREE.Mesh(boxGeo, boxMat.clone()); rB.position.copy(midB); group.add(rB);

        const labelPos = new THREE.Vector3().lerpVectors(midA, midB, 0.5);
        addLabel(labelPos.x, midA.y + 8, def.name, 18, labelPos.z, 'rgba(0,50,80,0.8)');

        scene.add(group);
        routes[id] = {
            group,
            curveATX, curveARX, curveBTX, curveBRX,
            meshATX, meshARX, meshBTX, meshBRX,
            relays: [rA, rB]
        };
    });
}

function createParticles() {
    const geo = new THREE.SphereGeometry(0.45, 6, 6);
    const createPool = (arr, color) => {
        for (let i = 0; i < 30; i += 1) {
            const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
            p.userData = { progress: Math.random(), speed: 0.002 + Math.random() * 0.002 };
            scene.add(p);
            arr.push(p);
        }
    };
    const a = CONFIG.colors.planeA, b = CONFIG.colors.planeB;
    createPool(particleSystems.A_Main_TX, a); createPool(particleSystems.A_Main_RX, a);
    createPool(particleSystems.A_Back_TX, a); createPool(particleSystems.A_Back_RX, a);
    createPool(particleSystems.B_Main_TX, b); createPool(particleSystems.B_Main_RX, b);
    createPool(particleSystems.B_Back_TX, b); createPool(particleSystems.B_Back_RX, b);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    let aMainActive = false;
    let aBackupActive = false;
    if (state.planeA) {
        if (state.strategy === '1+1') {
            if (state.route1) aMainActive = true;
            if (state.route2) aBackupActive = true;
        } else {
            if (state.route1) {
                aMainActive = true;
            } else if (state.route2) {
                aBackupActive = true;
            }
        }
    }
    updateSystem(particleSystems.A_Main_TX, 1, 'curveATX', aMainActive);
    updateSystem(particleSystems.A_Main_RX, 1, 'curveARX', aMainActive);
    updateSystem(particleSystems.A_Back_TX, 2, 'curveATX', aBackupActive);
    updateSystem(particleSystems.A_Back_RX, 2, 'curveARX', aBackupActive);

    let bMainActive = false;
    let bBackupActive = false;
    if (state.planeB) {
        if (state.strategy === '1+1') {
            if (state.route3) bMainActive = true;
            if (state.route2) bBackupActive = true;
        } else {
            if (state.route3) {
                bMainActive = true;
            } else if (state.route2) {
                bBackupActive = true;
            }
        }
    }
    updateSystem(particleSystems.B_Main_TX, 3, 'curveBTX', bMainActive);
    updateSystem(particleSystems.B_Main_RX, 3, 'curveBRX', bMainActive);
    updateSystem(particleSystems.B_Back_TX, 2, 'curveBTX', bBackupActive);
    updateSystem(particleSystems.B_Back_RX, 2, 'curveBRX', bBackupActive);

    renderer.render(scene, camera);
}

function updateSystem(system, routeId, curveKey, isActive) {
    const r = routes[routeId];
    system.forEach(p => {
        if (!r) {
            p.visible = false;
            return;
        }
        p.visible = isActive;
        if (isActive) {
            p.userData.progress += p.userData.speed;
            if (p.userData.progress > 1) p.userData.progress = 0;
            p.position.copy(r[curveKey].getPoint(p.userData.progress));
        }
    });
}

function setStrategy(mode) {
    state.strategy = mode;
    const btn1 = document.getElementById('strat-1plus1');
    const btn2 = document.getElementById('strat-1to1');
    if (btn1 && btn2) {
        btn1.className = mode === '1+1' ? 'strategy-btn selected' : 'strategy-btn';
        btn2.className = mode === '1:1' ? 'strategy-btn selected' : 'strategy-btn';
    }
    const badge = document.getElementById('mode-badge');
    if (badge) badge.innerText = `${mode} ${mode === '1+1' ? '(并发)' : '(主备)'}`;
    const desc = document.getElementById('strategy-desc');
    if (desc) {
        desc.innerText = mode === '1+1'
            ? '当前：双发选收模式。为了最高可靠性，备用路由始终保持并发传输，无切换延迟。'
            : '当前：主备倒换模式。平时备用路由空闲(节省处理资源)，仅在主路由中断时启用。';
    }
    updateStatus();
}

function togglePlane(p) {
    const key = `plane${p}`;
    state[key] = !state[key];
    const btn = document.getElementById(`btn-plane${p}`);
    if (btn) btn.className = state[key] ? 'active' : '';
    const on = state[key];
    deviceMeshes[p].forEach(mesh => {
        // 跳过已被路由故障变暗的设备（不覆盖路由故障状态）
        if (!on || !mesh.userData.routeFault) {
            mesh.material.opacity = on ? 1.0 : 0.15;
            mesh.material.transparent = !on;
            mesh.material.emissive.setHex(on ? 0x001122 : 0x000000);
            mesh.material.needsUpdate = true;
        }
    });
    updateStatus();
}

function toggleRoute(id) {
    const key = `route${id}`;
    state[key] = !state[key];
    const on = state[key];
    const btn = document.getElementById(`btn-r${id}`);
    const route = routes[id];

    if (btn) btn.className = on ? 'danger' : 'danger fault-on';

    if (route) {
        // 平面A 两根光纤 (TX + RX)
        [route.meshATX, route.meshARX].forEach(m => {
            m.material.color.setHex(on ? CONFIG.colors.fiberA : CONFIG.colors.broken);
            m.material.opacity = on ? 0.55 : 0.1;
        });
        // 平面B 两根光纤 (TX + RX)
        [route.meshBTX, route.meshBRX].forEach(m => {
            m.material.color.setHex(on ? CONFIG.colors.fiberB : CONFIG.colors.broken);
            m.material.opacity = on ? 0.55 : 0.1;
        });
        // 中继盒
        route.relays.forEach(box => box.material.color.setHex(on ? CONFIG.colors.relay : 0x550000));
    }

    // 该路由对应的波分设备同步变暗/恢复
    routeWDMs[id].forEach(mesh => {
        mesh.userData.routeFault = !on;
        // 如果所属平面本身也离线，不要覆盖平面的状态
        const planeOff = (deviceMeshes.A.includes(mesh) && !state.planeA)
                      || (deviceMeshes.B.includes(mesh) && !state.planeB);
        if (!planeOff) {
            mesh.material.opacity = on ? 1.0 : 0.2;
            mesh.material.transparent = !on;
            mesh.material.emissive.setHex(on ? 0x001122 : 0x000000);
            mesh.material.needsUpdate = true;
        }
    });

    updateStatus();
}

function updateStatus() {
    const offline = "<span class='status-val err'>平面离线</span>";
    let a1, a2, b3, b2;

    if (!state.planeA) {
        a1 = offline;
        a2 = offline;
    } else if (state.strategy === '1+1') {
        a1 = state.route1 ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
        a2 = state.route2 ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
    } else {
        a1 = state.route1 ? "<span class='status-val ok'>主用工作中</span>" : "<span class='status-val err'>中断</span>";
        a2 = (!state.route1 && state.route2) ? "<span class='status-val warn'>备用激活!</span>" : (state.route2 ? "<span class='status-val idle'>闲置待命</span>" : "<span class='status-val err'>中断</span>");
    }

    if (!state.planeB) {
        b3 = offline;
        b2 = offline;
    } else if (state.strategy === '1+1') {
        b3 = state.route3 ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
        b2 = state.route2 ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
    } else {
        b3 = state.route3 ? "<span class='status-val ok'>主用工作中</span>" : "<span class='status-val err'>中断</span>";
        b2 = (!state.route3 && state.route2) ? "<span class='status-val warn'>备用激活!</span>" : (state.route2 ? "<span class='status-val idle'>闲置待命</span>" : "<span class='status-val err'>中断</span>");
    }

    // 1:1 模式下双平面同时争用中线备路由时告警
    const contentionEl = document.getElementById('status-contention');
    if (state.strategy === '1:1' && state.route2
        && state.planeA && !state.route1
        && state.planeB && !state.route3) {
        a2 = "<span class='status-val warn'>备用激活 (争用)</span>";
        b2 = "<span class='status-val warn'>备用激活 (争用)</span>";
        if (contentionEl) contentionEl.innerHTML = "<span class='status-val warn'>⚠ 中线共享备路由双平面争用中</span>";
    } else {
        if (contentionEl) contentionEl.innerHTML = '';
    }

    const statusA1 = document.getElementById('status-a-route1');
    const statusA2 = document.getElementById('status-a-route2');
    const statusB3 = document.getElementById('status-b-route3');
    const statusB2 = document.getElementById('status-b-route2');
    if (statusA1) statusA1.innerHTML = `⚫ 北线(主): ${a1}`;
    if (statusA2) statusA2.innerHTML = `⚫ 中线(备): ${a2}`;
    if (statusB3) statusB3.innerHTML = `⚫ 南线(主): ${b3}`;
    if (statusB2) statusB2.innerHTML = `⚫ 中线(备): ${b2}`;
}


function addLabel(x, y, text, size = 12, z = 0, bg = 'rgba(0,0,0,0.5)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sp.position.set(x, y, z);
    sp.scale.set(size, size / 4, 1);
    scene.add(sp);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.setStrategy = setStrategy;
window.togglePlane = togglePlane;
window.toggleRoute = toggleRoute;

init();
