import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const passed = [], failed = [];
const check = (name, cond, detail = '') => {
  (cond ? passed : failed).push(name);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? `   ${detail}` : ''));
};

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function login(phone, role) {
  const { data } = await call('POST', '/auth/request-otp', { phone, role });
  const out = await call('POST', '/auth/verify-otp', { phone, code: data.devCode });
  return [out.data.accessToken, out.data.user];
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });

const waitFor = (socket, event, ms = 8000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });

console.log('=== socket handshake ===');
let rejected = false;
try { await connect('not-a-jwt'); } catch { rejected = true; }
check('handshake rejects a bad JWT', rejected);

const [ftok, farmer] = await login('9000000021', 'FARMER');
const [ttok] = await login('9000000002', 'TRANSPORTER');
const fsock = await connect(ftok);
check('handshake accepts a valid JWT', fsock.connected);

console.log('\n=== match:new arrives live ===');
// join before the request exists is impossible, so create then join, then re-run matching
const req = (await call('POST', '/transport/requests', {
  cropType: 'Tomato', quantityKg: 500,
  pickup: { name: 'Pimpri, Pune', lat: 18.5204, lng: 73.8567 },
  destination: { name: 'Lasalgaon Mandi', lat: 20.1417, lng: 74.2389 },
  preferredDate: '2026-08-29T06:00:00.000Z',
}, ftok)).data;

fsock.emit('join:request', { requestId: req._id });
await new Promise((r) => setTimeout(r, 400));

const matches = (await call('GET', `/transport/requests/${req._id}/matches`, null, ftok)).data;
check('matching produced offers', matches.length > 0, `${matches.length} matches`);

console.log('\n=== room authorisation ===');
const [otok] = await login('9000000022', 'FARMER');
const osock = await connect(otok);
osock.emit('join:trip', { tripId: req._id });
const denial = await waitFor(osock, 'error', 4000);
check('a stranger cannot join another trip room',
  denial && denial.error.code === 'AUTH_FORBIDDEN', denial?.error?.code ?? 'no error emitted');
check('socket errors use the same envelope',
  denial && denial.success === false && typeof denial.requestId === 'string' && denial.requestId.startsWith('req_'));

console.log('\n=== book, then live trip events ===');
await call('POST', `/transport/requests/${req._id}/accept`, { vehicleId: matches[0].vehicleId }, ftok);
const order = (await call('POST', '/payments/create-order', { requestId: req._id }, ftok)).data;

fsock.emit('join:trip', { tripId: req._id });
await new Promise((r) => setTimeout(r, 300));
const capturedP = waitFor(fsock, 'payment:captured');
const statusP = waitFor(fsock, 'trip:status');

await call('POST', '/payments/verify', {
  razorpay_order_id: order.razorpayOrderId,
  razorpay_payment_id: 'pay_demo_socket',
  razorpay_signature: 'demo',
}, ftok);

const captured = await capturedP;
check('payment:captured reaches the farmer', captured?.requestId === req._id, captured?.paymentId ?? 'not received');
const status = await statusP;
check('trip:status BOOKED emitted', status?.status === 'BOOKED', status?.status ?? 'not received');

console.log('\n=== live location relay ===');
const tsock = await connect(ttok);
tsock.emit('join:trip', { tripId: req._id });
await new Promise((r) => setTimeout(r, 400));

const locationP = waitFor(fsock, 'trip:location');
tsock.emit('vehicle:location', { tripId: req._id, lat: 18.62, lng: 73.91 });
const location = await locationP;
check('transporter GPS reaches the farmer',
  location && Math.abs(location.lat - 18.62) < 0.001, location ? `${location.lat},${location.lng}` : 'not received');
check('ETA is attached to the location event',
  location && typeof location.etaMinutes === 'number', location ? `${location.etaMinutes} min` : '');

console.log('\n=== in-trip chat ===');
const chatP = waitFor(tsock, 'chat:message');
fsock.emit('chat:send', { tripId: req._id, text: 'Gate number 3 please' });
const chat = await chatP;
check('chat message relayed to the other party', chat?.text === 'Gate number 3 please', chat?.text ?? 'not received');
check('sender identified from the JWT, not the payload', chat?.senderId === farmer._id);

const history = (await call('GET', `/transport/requests/${req._id}/messages`, null, ttok)).data;
check('chat history is persisted for reconnects', history.length >= 1, `${history.length} message(s)`);

const emptyP = waitFor(tsock, 'chat:message', 2500);
const errP = waitFor(fsock, 'error', 2500);
fsock.emit('chat:send', { tripId: req._id, text: '   ' });
check('empty message is refused', (await errP)?.error?.code === 'VALIDATION_ERROR' && !(await emptyP));

fsock.close(); tsock.close(); osock.close();
console.log(`\n${passed.length} passed, ${failed.length} failed`);
if (failed.length) { console.log('FAILURES:', failed); process.exit(1); }
