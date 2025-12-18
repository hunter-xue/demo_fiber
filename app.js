import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const apiKey = '';

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
const connectPoints = {
    A: { optTop: null, optBot: null },
    B: { optTop: null, optBot: null }
};
const particleSystems = {
    A_Main: [],
    A_Backup: [],
    B_Main: [],
    B_Backup: []
};

const CONFIG = {
    siteOffset: 90,
    elecOffset: 120,
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
    const sl1 = new THREE.PointLight(0x00ffff, 0.5, 150); sl1.position.set(-CONFIG.siteOffset, 60, 20); scene.add(sl1);
    const sl2 = new THREE.PointLight(0xffaa00, 0.5, 150); sl2.position.set(CONFIG.siteOffset, 60, 20); scene.add(sl2);
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
    const createRoom = x => {
        const geo = new THREE.BoxGeometry(70, 55, 50);
        const edges = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineBasicMaterial({ color: 0x334455, opacity: 0.3, transparent: true });
        const mesh = new THREE.LineSegments(edges, mat);
        mesh.position.set(x, 27.5, 0);
        scene.add(mesh);
    };

    createRoom(-105);
    createRoom(105);

    const elecGeo = new THREE.BoxGeometry(8, 6, 12);
    const createElecStack = siteX => {
        const elecA = new THREE.Mesh(elecGeo, new THREE.MeshPhongMaterial({ color: CONFIG.colors.elecDev, emissive: 0x332200 }));
        elecA.position.set(siteX, 25, -10);
        scene.add(elecA);
        const elecB = new THREE.Mesh(elecGeo, new THREE.MeshPhongMaterial({ color: CONFIG.colors.elecDev, emissive: 0x332200 }));
        elecB.position.set(siteX, 10, -10);
        scene.add(elecB);
    };
    createElecStack(-CONFIG.elecOffset);
    createElecStack(CONFIG.elecOffset);

    const optGeo = new THREE.BoxGeometry(6, 4, 8);
    const createOptStack = (siteX, zOffset, isConnector, isLeft) => {
        const optA = new THREE.Mesh(optGeo, new THREE.MeshPhongMaterial({ color: CONFIG.colors.optDev, emissive: 0x001122 }));
        optA.position.set(siteX, 18, zOffset);
        scene.add(optA);
        const optB = new THREE.Mesh(optGeo, new THREE.MeshPhongMaterial({ color: CONFIG.colors.optDev, emissive: 0x001122 }));
        optB.position.set(siteX, 8, zOffset);
        scene.add(optB);

        const pt = isLeft ? connectPoints.A : connectPoints.B;
        const dir = isLeft ? 1 : -1;
        if (isConnector) {
            pt.optTop = new THREE.Vector3(siteX + 3 * dir, 18, zOffset);
            pt.optBot = new THREE.Vector3(siteX + 3 * dir, 8, zOffset);
        }
    };

    createOptStack(-CONFIG.siteOffset - 8, -10, false, true);
    createOptStack(-CONFIG.siteOffset + 2, 0, true, true);
    createOptStack(-CONFIG.siteOffset + 10, 12, false, true);

    createOptStack(CONFIG.siteOffset + 8, -10, false, false);
    createOptStack(CONFIG.siteOffset - 2, 0, true, false);
    createOptStack(CONFIG.siteOffset - 10, 12, false, false);
}

function createRoutes() {
    const defs = [
        { id: 1, name: '北线', z: -55 },
        { id: 2, name: '中线', z: 0 },
        { id: 3, name: '南线', z: 55 }
    ];
    const startT = connectPoints.A.optTop;
    const startB = connectPoints.A.optBot;
    const endT = connectPoints.B.optTop;
    const endB = connectPoints.B.optBot;

    defs.forEach(def => {
        const group = new THREE.Group();
        const dist = endT.x - startT.x;
        const ctrlX1 = startT.x + dist * 0.25;
        const ctrlX2 = startT.x + dist * 0.75;
        const midY = 12;
        const yGap = 4;

        const createCurve = (start, end, yOffset) => new THREE.CatmullRomCurve3([
            start,
            new THREE.Vector3(start.x + 20, start.y, start.z),
            new THREE.Vector3(ctrlX1, midY + yOffset, def.z),
            new THREE.Vector3(ctrlX2, midY + yOffset, def.z),
            new THREE.Vector3(end.x - 20, end.y, end.z),
            end
        ]);

        const curveA = createCurve(startT, endT, yGap);
        const curveB = createCurve(startB, endB, -yGap);

        const matA = new THREE.MeshPhongMaterial({ color: CONFIG.colors.fiberA, transparent: true, opacity: 0.5 });
        const matB = new THREE.MeshPhongMaterial({ color: CONFIG.colors.fiberB, transparent: true, opacity: 0.5 });
        const meshA = new THREE.Mesh(new THREE.TubeGeometry(curveA, 120, 0.4, 8, false), matA);
        const meshB = new THREE.Mesh(new THREE.TubeGeometry(curveB, 120, 0.4, 8, false), matB);
        group.add(meshA);
        group.add(meshB);

        const ptA = curveA.getPoint(0.5);
        const ptB = curveB.getPoint(0.5);
        const midPos = new THREE.Vector3().lerpVectors(ptA, ptB, 0.5);
        const relayGroup = new THREE.Group();
        relayGroup.position.copy(midPos);
        const boxGeo = new THREE.BoxGeometry(4, 3, 4);
        const boxMat = new THREE.MeshLambertMaterial({ color: CONFIG.colors.relay });
        const rA = new THREE.Mesh(boxGeo, boxMat); rA.position.copy(ptA).sub(midPos);
        const rB = new THREE.Mesh(boxGeo, boxMat); rB.position.copy(ptB).sub(midPos);
        relayGroup.add(rA);
        relayGroup.add(rB);
        group.add(relayGroup);

        addLabel(midPos.x, midPos.y + 10, def.name, 12, midPos.z, 'rgba(0,50,80,0.6)');

        scene.add(group);
        routes[def.id] = { group, curveA, curveB, relays: [rA, rB], meshA, meshB };
    });
}

function createParticles() {
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const createPool = (arr, color) => {
        for (let i = 0; i < 60; i += 1) {
            const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
            p.userData = { progress: Math.random(), speed: 0.002 + Math.random() * 0.002 };
            scene.add(p);
            arr.push(p);
        }
    };
    createPool(particleSystems.A_Main, CONFIG.colors.planeA);
    createPool(particleSystems.A_Backup, CONFIG.colors.planeA);
    createPool(particleSystems.B_Main, CONFIG.colors.planeB);
    createPool(particleSystems.B_Backup, CONFIG.colors.planeB);
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
    updateSystem(particleSystems.A_Main, 1, 'curveA', aMainActive);
    updateSystem(particleSystems.A_Backup, 2, 'curveA', aBackupActive);

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
    updateSystem(particleSystems.B_Main, 3, 'curveB', bMainActive);
    updateSystem(particleSystems.B_Backup, 2, 'curveB', bBackupActive);

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
    updateStatus();
}

function toggleRoute(id) {
    const key = `route${id}`;
    state[key] = !state[key];
    const btn = document.getElementById(`btn-r${id}`);
    const route = routes[id];
    if (state[key]) {
        if (btn) btn.className = 'danger';
        if (route) {
            route.meshA.material.color.setHex(CONFIG.colors.fiberA); route.meshA.material.opacity = 0.5;
            route.meshB.material.color.setHex(CONFIG.colors.fiberB); route.meshB.material.opacity = 0.5;
            route.relays.forEach(box => box.material.color.setHex(CONFIG.colors.relay));
        }
    } else {
        if (btn) btn.className = 'danger active';
        if (route) {
            route.meshA.material.color.setHex(CONFIG.colors.broken); route.meshA.material.opacity = 0.1;
            route.meshB.material.color.setHex(CONFIG.colors.broken); route.meshB.material.opacity = 0.1;
            route.relays.forEach(box => box.material.color.setHex(0x550000));
        }
    }
    updateStatus();
}

function updateStatus() {
    const aMainOk = state.route1;
    const aBackOk = state.route2;
    const bMainOk = state.route3;
    const bBackOk = state.route2;

    let a1;
    let a2;
    let b3;
    let b2;

    if (state.strategy === '1+1') {
        a1 = aMainOk ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
        a2 = aBackOk ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
        b3 = bMainOk ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
        b2 = bBackOk ? "<span class='status-val ok'>工作中 (并发)</span>" : "<span class='status-val err'>中断</span>";
    } else {
        a1 = aMainOk ? "<span class='status-val ok'>主用工作中</span>" : "<span class='status-val err'>中断</span>";
        a2 = (!aMainOk && aBackOk) ? "<span class='status-val warn'>备用激活!</span>" : (aBackOk ? "<span class='status-val idle'>闲置待命</span>" : "<span class='status-val err'>中断</span>");
        b3 = bMainOk ? "<span class='status-val ok'>主用工作中</span>" : "<span class='status-val err'>中断</span>";
        b2 = (!bMainOk && bBackOk) ? "<span class='status-val warn'>备用激活!</span>" : (bBackOk ? "<span class='status-val idle'>闲置待命</span>" : "<span class='status-val err'>中断</span>");
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

async function runAI() {
    const input = document.getElementById('ai-input');
    const out = document.getElementById('ai-output');
    if (!input || !out) return;
    const txt = input.value.trim();
    if (!txt) return;
    out.innerText = 'Gemini 解析中...';
    const prompt = `网络AI控制。用户指令:"${txt}"。\n            网络状态对象: {planeA, planeB, route1, route2, route3, strategy}。\n            strategy值只能是 '1+1' 或 '1:1'。\n            返回JSON格式的变更，例如 {"strategy": "1:1", "route1": false}。`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const payload = await res.json();
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const json = JSON.parse(text.replace(/```json|```/g, ''));
        const changes = [];
        Object.keys(json).forEach(key => {
            if (state[key] === json[key]) return;
            if (key === 'strategy') {
                setStrategy(json[key]);
            } else if (key.startsWith('plane')) {
                togglePlane(key.replace('plane', ''));
            } else if (key.startsWith('route')) {
                toggleRoute(parseInt(key.replace('route', ''), 10));
            }
            changes.push(key);
        });
        out.innerText = changes.length ? `已执行: ${changes.join(', ')}` : '无变更';
    } catch (err) {
        out.innerText = 'Error';
    }
}

async function diagnose() {
    const out = document.getElementById('ai-output');
    if (!out) return;
    out.innerText = '诊断中...';
    const data = {
        策略: state.strategy,
        A平面: state.planeA ? 'ON' : 'OFF',
        B平面: state.planeB ? 'ON' : 'OFF',
        北线: state.route1 ? 'OK' : 'Cut',
        中线: state.route2 ? 'OK' : 'Cut',
        南线: state.route3 ? 'OK' : 'Cut'
    };
    const prompt = `生成简短报告: ${JSON.stringify(data)}. \n            如果是1:1模式，检查主备倒换是否生效；如果是1+1，检查是否双路并发。`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const payload = await res.json();
        out.innerText = payload.candidates?.[0]?.content?.parts?.[0]?.text || '完成';
    } catch (err) {
        out.innerText = 'Error';
    }
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
window.runAI = runAI;
window.diagnose = diagnose;

init();
