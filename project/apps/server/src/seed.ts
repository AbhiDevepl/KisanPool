// /**
//  * Demo data.
//  *
//  * Non-destructive by default: accounts are upserted by phone, so running it twice
//  * is safe and it will not touch anything you created by hand. Pass --reset to wipe
//  * the demo accounts and every trip/offer/shipment first.
//  *
//  *   npm run seed                 # top up, delete nothing
//  *   npm run seed -- --reset      # start clean
//  */
// import { connectDb, disconnectDb } from './db';
// import {
//   KycDocument,
//   Payment,
//   PricingEvent,
//   Rating,
//   TransporterOffer,
//   TransporterPayoutAccount,
//   TransportRequest,
//   Trip,
//   TripShipment,
//   User,
//   Vehicle,
// } from './models';

// const PUNE = { lat: 18.5204, lng: 73.8567 };
// const LASALGAON = { name: 'Lasalgaon Mandi', lat: 20.1417, lng: 74.2389 };
// const RESET = process.argv.includes('--reset');

// const COMMENTS = [
//   'Reached on time, handled the crates well.',
//   'Good driver, kept me updated on the way.',
//   'Produce arrived in good condition.',
//   'Slightly late but careful with the load.',
//   'Very helpful at the mandi gate.',
// ];

// const TRANSPORTERS = [
//   { name: 'Mahesh Jadhav', phone: '9000000002', reg: 'MH15 AB 1234', type: 'TRUCK', cap: 4000, rate: 42, stars: [5, 5, 5, 4, 5], offset: 0.03 },
//   { name: 'Sunil Kadam', phone: '9000000003', reg: 'MH12 CD 5678', type: 'MINI_TRUCK', cap: 2500, rate: 36, stars: [5, 4, 5, 4, 5], offset: 0.06 },
//   { name: 'Anil Shinde', phone: '9000000004', reg: 'MH14 EF 9012', type: 'TEMPO', cap: 1500, rate: 30, stars: [4, 4, 5, 4, 4], offset: 0.09 },
// ] as const;

// /** Same rollup the ratings route performs — derived, never hand-written. */
// async function rollUpRating(userId: string): Promise<void> {
//   const all = await Rating.find({ toUserId: userId });
//   if (!all.length) return;
//   const avg = all.reduce((sum, r) => sum + r.stars, 0) / all.length;
//   await User.findByIdAndUpdate(userId, {
//     ratingAvg: Math.round(avg * 10) / 10,
//     ratingCount: all.length,
//   });
// }

// async function upsertUser(phone: string, fields: Record<string, unknown>) {
//   return User.findOneAndUpdate(
//     { phone },
//     { $set: { phone, ...fields }, $setOnInsert: { phoneVerifiedAt: new Date() } },
//     { new: true, upsert: true, setDefaultsOnInsert: true },
//   );
// }

// async function main(): Promise<void> {
//   await connectDb();

//   if (RESET) {
//     // 9000* is demo data, 9100* is what the integration suites create. Anything
//     // else — a real number someone signed up with by hand — is left alone.
//     const demoPhones = { phone: { $regex: '^9(000|100)' } };
//     const demoUsers = await User.find(demoPhones, '_id');
//     const ids = demoUsers.map((u) => u._id);

//     // only demo data — anything you created with a real phone number survives
//     await Promise.all([
//       Vehicle.deleteMany({ ownerId: { $in: ids } }),
//       KycDocument.deleteMany({ userId: { $in: ids } }),
//       TransportRequest.deleteMany({ farmerId: { $in: ids } }),
//       TransporterOffer.deleteMany({ transporterId: { $in: ids } }),
//       Trip.deleteMany({ transporterId: { $in: ids } }),
//       TripShipment.deleteMany({ farmerId: { $in: ids } }),
//       PricingEvent.deleteMany({}),
//       Payment.deleteMany({ farmerId: { $in: ids } }),
//       TransporterPayoutAccount.deleteMany({ userId: { $in: ids } }),
//       Rating.deleteMany({ $or: [{ fromUserId: { $in: ids } }, { toUserId: { $in: ids } }] }),
//       User.deleteMany(demoPhones),
//     ]);
//     console.log('[seed] demo (9000*) and test (9100*) accounts cleared');
//   }

//   const farmer = await upsertUser('9000000001', {
//     name: 'Rahul Patil',
//     role: 'FARMER',
//     language: 'mr',
//     defaultLocation: { name: 'Pimpri, Pune', ...PUNE },
//   });

//   // two more farmers so the pooling demo has someone to pool with
//   const farmer2 = await upsertUser('9000000006', {
//     name: 'Ganesh More',
//     role: 'FARMER',
//     language: 'mr',
//     defaultLocation: { name: 'Chinchwad, Pune', lat: 18.6298, lng: 73.7997 },
//   });
//   const farmer3 = await upsertUser('9000000007', {
//     name: 'Sanjay Deshmukh',
//     role: 'FARMER',
//     language: 'hi',
//     defaultLocation: { name: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389 },
//   });

//   for (const t of TRANSPORTERS) {
//     const user = await upsertUser(t.phone, { name: t.name, role: 'TRANSPORTER', language: 'mr' });

//     const vehicle = await Vehicle.findOneAndUpdate(
//       { ownerId: user._id },
//       {
//         ownerId: user._id,
//         vehicleType: t.type,
//         registrationNumber: t.reg,
//         capacityKg: t.cap,
//         availableCapacityKg: t.cap,
//         ratePerKm: t.rate,
//         status: 'AVAILABLE',
//         verificationStatus: 'VERIFIED',
//         currentLocation: { lat: PUNE.lat + t.offset, lng: PUNE.lng + t.offset },
//       },
//       { new: true, upsert: true, setDefaultsOnInsert: true },
//     );

//     for (const type of ['RC', 'DL', 'PAN'] as const) {
//       await KycDocument.findOneAndUpdate(
//         { userId: user._id, type },
//         {
//           userId: user._id,
//           type,
//           fileUrl: `/uploads/seed/${type.toLowerCase()}.jpg`,
//           status: 'VERIFIED',
//           reviewedAt: new Date(),
//         },
//         { upsert: true, setDefaultsOnInsert: true },
//       );
//     }

//     await TransporterPayoutAccount.findOneAndUpdate(
//       { userId: user._id },
//       {
//         userId: user._id,
//         razorpayAccountId: `acc_demo_${user._id}`,
//         payoutStatus: 'ACTIVE',
//         bankAccountLast4: '4321',
//         ifsc: 'HDFC0001234',
//       },
//       { upsert: true, setDefaultsOnInsert: true },
//     );

//     // completed past trips, each carrying the review that backs the rating
//     const existingRatings = await Rating.countDocuments({ toUserId: user._id });
//     if (!existingRatings) {
//       for (const [index, stars] of t.stars.entries()) {
//         const daysAgo = (index + 1) * 6;
//         const at = new Date(Date.now() - daysAgo * 86400000);
//         const quantityKg = 600 + index * 120;
//         const price = Math.round(185 * t.rate);

//         const request = await TransportRequest.create({
//           farmerId: farmer._id,
//           cropType: index % 2 === 0 ? 'Onion' : 'Tomato',
//           quantityKg,
//           pickup: { name: 'Pimpri, Pune', ...PUNE },
//           destination: LASALGAON,
//           preferredDate: at,
//           state: 'CONFIRMED',
//         });

//         const trip = await Trip.create({
//           transporterId: user._id,
//           vehicleId: vehicle._id,
//           destination: LASALGAON,
//           state: 'COMPLETED',
//           totalCapacityKg: t.cap,
//           routeDistanceKm: 185,
//           estimatedRouteCost: 185 * t.rate,
//           pricingVersion: 1,
//           startedAt: at,
//           completedAt: new Date(at.getTime() + 3 * 3600000),
//         });

//         const shipment = await TripShipment.create({
//           tripId: trip._id,
//           requestId: request._id,
//           farmerId: farmer._id,
//           quantityKg,
//           cropType: request.cropType,
//           pickup: { name: 'Pimpri, Pune', ...PUNE },
//           pickupSequence: 1,
//           state: 'COMPLETED',
//           allocatedPrice: price,
//           finalPrice: price,
//           soloPrice: price,
//           pickupOtp: '0000',
//           pickedUpAt: at,
//           deliveredAt: new Date(at.getTime() + 3 * 3600000),
//         });

//         request.tripId = trip._id;
//         await request.save();

//         await Rating.create({
//           tripId: trip._id,
//           shipmentId: shipment._id,
//           fromUserId: farmer._id,
//           toUserId: user._id,
//           stars,
//           comment: COMMENTS[index % COMMENTS.length],
//         });
//         await Rating.create({
//           tripId: trip._id,
//           shipmentId: shipment._id,
//           fromUserId: user._id,
//           toUserId: farmer._id,
//           stars: 5,
//           comment: 'Load was ready on time.',
//         });
//       }
//       await rollUpRating(String(user._id));
//     }
//   }

//   await rollUpRating(String(farmer._id));

//   // a transporter left PENDING so the KYC gate stays demonstrable
//   const pending = await upsertUser('9000000005', {
//     name: 'Vikas Pawar',
//     role: 'TRANSPORTER',
//     language: 'hi',
//   });
//   await Vehicle.findOneAndUpdate(
//     { ownerId: pending._id },
//     {
//       ownerId: pending._id,
//       vehicleType: 'PICKUP',
//       registrationNumber: 'MH11 GH 3456',
//       capacityKg: 1200,
//       availableCapacityKg: 1200,
//       ratePerKm: 28,
//       status: 'OFFLINE',
//       verificationStatus: 'PENDING',
//       currentLocation: { lat: PUNE.lat + 0.02, lng: PUNE.lng + 0.02 },
//     },
//     { upsert: true, setDefaultsOnInsert: true },
//   );
//   await KycDocument.findOneAndUpdate(
//     { userId: pending._id, type: 'RC' },
//     { userId: pending._id, type: 'RC', fileUrl: '/uploads/seed/rc.jpg', status: 'PENDING' },
//     { upsert: true, setDefaultsOnInsert: true },
//   );

//   // three open requests to the same mandi — the pool a transporter will see
//   for (const [i, f] of [farmer, farmer2, farmer3].entries()) {
//     const open = await TransportRequest.findOne({ farmerId: f._id, state: 'OPEN' });
//     if (open) continue;
//     await TransportRequest.create({
//       farmerId: f._id,
//       cropType: ['Onion', 'Tomato', 'Potato'][i],
//       quantityKg: [400, 700, 500][i],
//       pickup: f.defaultLocation ?? { name: 'Pimpri, Pune', ...PUNE },
//       destination: LASALGAON,
//       preferredDate: new Date(Date.now() + 86400000),
//       state: 'OPEN',
//       expiresAt: new Date(Date.now() + 24 * 3600000),
//     });
//   }

//   console.log(`
// Seeded${RESET ? ' (after reset)' : ' (nothing deleted)'}.

//   Farmers       9000000001 Rahul Patil    (Marathi)
//                 9000000006 Ganesh More
//                 9000000007 Sanjay Deshmukh
//   Transporters  9000000002 / 9000000003 / 9000000004  (verified)
//                 9000000005  (KYC pending — sees no pool)

//   3 open requests to Lasalgaon Mandi are waiting in the pool — enough for one
//   4-tonne truck to claim all three and show pooled pricing.

// OTP codes print to the server console in demo mode.
// `);

//   await disconnectDb();
// }

// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
