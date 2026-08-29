/**
 * Demo data.
 *
 * Non-destructive by default: accounts are upserted by phone, so running it twice
 * is safe and it will not touch anything you created by hand. Pass --reset to wipe
 * the demo accounts and every trip/offer/shipment first.
 *
 *   npm run seed                 # top up, delete nothing
 *   npm run seed -- --reset      # start clean
 */
import { connectDb, disconnectDb } from './db';
import {
  BackhaulBooking,
  BackhaulRequest,
  FarmMachine,
  KycDocument,
  MachineBooking,
  Payment,
  PricingEvent,
  Rating,
  TransporterOffer,
  TransporterPayoutAccount,
  TransportRequest,
  Trip,
  TripShipment,
  User,
  Vehicle,
} from './models';

const PUNE = { lat: 18.5204, lng: 73.8567 };
const LASALGAON = { name: 'Lasalgaon Mandi', lat: 20.1417, lng: 74.2389 };
const RESET = process.argv.includes('--reset');

const COMMENTS = [
  'Reached on time, handled the crates well.',
  'Good driver, kept me updated on the way.',
  'Produce arrived in good condition.',
  'Slightly late but careful with the load.',
  'Very helpful at the mandi gate.',
];

const TRANSPORTERS = [
  { name: 'Mahesh Jadhav', phone: '9000000002', reg: 'MH15 AB 1234', type: 'TRUCK', cap: 4000, rate: 42, stars: [5, 5, 5, 4, 5], offset: 0.03 },
  { name: 'Sunil Kadam', phone: '9000000003', reg: 'MH12 CD 5678', type: 'MINI_TRUCK', cap: 2500, rate: 36, stars: [5, 4, 5, 4, 5], offset: 0.06 },
  { name: 'Anil Shinde', phone: '9000000004', reg: 'MH14 EF 9012', type: 'TEMPO', cap: 1500, rate: 30, stars: [4, 4, 5, 4, 4], offset: 0.09 },
] as const;

/** Same rollup the ratings route performs — derived, never hand-written. */
async function rollUpRating(userId: string): Promise<void> {
  const all = await Rating.find({ toUserId: userId });
  if (!all.length) return;
  const avg = all.reduce((sum, r) => sum + r.stars, 0) / all.length;
  await User.findByIdAndUpdate(userId, {
    ratingAvg: Math.round(avg * 10) / 10,
    ratingCount: all.length,
  });
}

async function upsertUser(phone: string, fields: Record<string, unknown>) {
  return User.findOneAndUpdate(
    { phone },
    { $set: { phone, ...fields }, $setOnInsert: { phoneVerifiedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

async function main(): Promise<void> {
  await connectDb();

  if (RESET) {
    // 9000* is demo data, 9100* is what the integration suites create. Anything
    // else — a real number someone signed up with by hand — is left alone.
    const demoPhones = { phone: { $regex: '^9(000|100)' } };
    const demoUsers = await User.find(demoPhones, '_id');
    const ids = demoUsers.map((u) => u._id);

    /*
     * The trips about to be deleted, resolved BEFORE the delete so their pricing
     * events can be removed with them.
     *
     * `PricingEvent.deleteMany({})` used to be unscoped while every other delete
     * here is scoped to demo users. That broke this block's own promise that real
     * data survives: a non-demo trip kept its `pricingVersion` and lost every
     * event behind it, leaving exactly the "price with no audit trail" state the
     * integrity checker flags as INCONSISTENT — created by the seed itself
     * (ADR-044).
     */
    const demoTripIds = (await Trip.find({ transporterId: { $in: ids } }, '_id')).map((t) => t._id);

    // only demo data — anything you created with a real phone number survives
    await Promise.all([
      Vehicle.deleteMany({ ownerId: { $in: ids } }),
      KycDocument.deleteMany({ userId: { $in: ids } }),
      TransportRequest.deleteMany({ farmerId: { $in: ids } }),
      TransporterOffer.deleteMany({ transporterId: { $in: ids } }),
      Trip.deleteMany({ transporterId: { $in: ids } }),
      TripShipment.deleteMany({ farmerId: { $in: ids } }),
      PricingEvent.deleteMany({ tripId: { $in: demoTripIds } }),
      Payment.deleteMany({ farmerId: { $in: ids } }),
      TransporterPayoutAccount.deleteMany({ userId: { $in: ids } }),
      Rating.deleteMany({ $or: [{ fromUserId: { $in: ids } }, { toUserId: { $in: ids } }] }),
      // V2 — the two new networks
      FarmMachine.deleteMany({ ownerId: { $in: ids } }),
      MachineBooking.deleteMany({ $or: [{ providerId: { $in: ids } }, { farmerId: { $in: ids } }] }),
      BackhaulRequest.deleteMany({ requesterId: { $in: ids } }),
      BackhaulBooking.deleteMany({ $or: [{ requesterId: { $in: ids } }, { transporterId: { $in: ids } }] }),
      User.deleteMany(demoPhones),
    ]);
    console.log('[seed] demo (9000*) and test (9100*) accounts cleared');
  }

  const farmer = await upsertUser('9000000001', {
    name: 'Rahul Patil',
    role: 'FARMER',
    language: 'mr',
    defaultLocation: { name: 'Pimpri, Pune', ...PUNE },
  });

  // two more farmers so the pooling demo has someone to pool with
  const farmer2 = await upsertUser('9000000006', {
    name: 'Ganesh More',
    role: 'FARMER',
    language: 'mr',
    defaultLocation: { name: 'Chinchwad, Pune', lat: 18.6298, lng: 73.7997 },
  });
  const farmer3 = await upsertUser('9000000007', {
    name: 'Sanjay Deshmukh',
    role: 'FARMER',
    language: 'hi',
    defaultLocation: { name: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389 },
  });

  for (const t of TRANSPORTERS) {
    const user = await upsertUser(t.phone, { name: t.name, role: 'TRANSPORTER', language: 'mr' });

    const vehicle = await Vehicle.findOneAndUpdate(
      { ownerId: user._id },
      {
        ownerId: user._id,
        vehicleType: t.type,
        registrationNumber: t.reg,
        capacityKg: t.cap,
        availableCapacityKg: t.cap,
        ratePerKm: t.rate,
        status: 'AVAILABLE',
        verificationStatus: 'VERIFIED',
        currentLocation: { lat: PUNE.lat + t.offset, lng: PUNE.lng + t.offset },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    for (const type of ['RC', 'DL', 'PAN'] as const) {
      await KycDocument.findOneAndUpdate(
        { userId: user._id, type },
        {
          userId: user._id,
          type,
          fileUrl: `/uploads/seed/${type.toLowerCase()}.jpg`,
          status: 'VERIFIED',
          reviewedAt: new Date(),
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    await TransporterPayoutAccount.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        razorpayAccountId: `acc_demo_${user._id}`,
        payoutStatus: 'ACTIVE',
        bankAccountLast4: '4321',
        ifsc: 'HDFC0001234',
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    // completed past trips, each carrying the review that backs the rating
    const existingRatings = await Rating.countDocuments({ toUserId: user._id });
    if (!existingRatings) {
      for (const [index, stars] of t.stars.entries()) {
        const daysAgo = (index + 1) * 6;
        const at = new Date(Date.now() - daysAgo * 86400000);
        const quantityKg = 600 + index * 120;
        const price = Math.round(185 * t.rate);

        const request = await TransportRequest.create({
          farmerId: farmer._id,
          cropType: index % 2 === 0 ? 'Onion' : 'Tomato',
          quantityKg,
          pickup: { name: 'Pimpri, Pune', ...PUNE },
          destination: LASALGAON,
          preferredDate: at,
          state: 'CONFIRMED',
        });

        const trip = await Trip.create({
          transporterId: user._id,
          vehicleId: vehicle._id,
          destination: LASALGAON,
          state: 'COMPLETED',
          totalCapacityKg: t.cap,
          routeDistanceKm: 185,
          estimatedRouteCost: 185 * t.rate,
          pricingVersion: 1,
          startedAt: at,
          completedAt: new Date(at.getTime() + 3 * 3600000),
        });

        const shipment = await TripShipment.create({
          tripId: trip._id,
          requestId: request._id,
          farmerId: farmer._id,
          quantityKg,
          cropType: request.cropType,
          pickup: { name: 'Pimpri, Pune', ...PUNE },
          pickupSequence: 1,
          state: 'COMPLETED',
          allocatedPrice: price,
          finalPrice: price,
          soloPrice: price,
          pickupOtp: '0000',
          pickedUpAt: at,
          deliveredAt: new Date(at.getTime() + 3 * 3600000),
        });

        request.tripId = trip._id;
        await request.save();

        /*
         * The pricing event these trips imply (ADR-044).
         *
         * `reallocate()` always writes the PricingEvent BEFORE bumping
         * `Trip.pricingVersion`, so in real operation the two always agree. The
         * seed used to set `pricingVersion: 1` directly and write no event,
         * which left every seeded trip looking — correctly — like a trip whose
         * pricing audit trail had been lost. The integrity checker found it, and
         * it was the seed that was wrong, not the check.
         */
        await PricingEvent.create({
          tripId: trip._id,
          version: 1,
          reason: 'seeded historical trip',
          routeDistanceKm: 185,
          routeCost: 185 * t.rate,
          totalQuantityKg: quantityKg,
          allocations: [
            {
              shipmentId: shipment._id,
              farmerId: farmer._id,
              quantityKg,
              rideKm: 185,
              detourKm: 0,
              tonneKm: Math.round((quantityKg / 1000) * 185 * 100) / 100,
              detourCost: 0,
              lineHaulCost: price,
              amount: price,
              previousAmount: null,
            },
          ],
        });

        await Rating.create({
          tripId: trip._id,
          shipmentId: shipment._id,
          fromUserId: farmer._id,
          toUserId: user._id,
          stars,
          comment: COMMENTS[index % COMMENTS.length],
        });
        await Rating.create({
          tripId: trip._id,
          shipmentId: shipment._id,
          fromUserId: user._id,
          toUserId: farmer._id,
          stars: 5,
          comment: 'Load was ready on time.',
        });
      }
      await rollUpRating(String(user._id));
    }
  }

  await rollUpRating(String(farmer._id));

  // a transporter left PENDING so the KYC gate stays demonstrable
  const pending = await upsertUser('9000000005', {
    name: 'Vikas Pawar',
    role: 'TRANSPORTER',
    language: 'hi',
  });
  await Vehicle.findOneAndUpdate(
    { ownerId: pending._id },
    {
      ownerId: pending._id,
      vehicleType: 'PICKUP',
      registrationNumber: 'MH11 GH 3456',
      capacityKg: 1200,
      availableCapacityKg: 1200,
      ratePerKm: 28,
      status: 'OFFLINE',
      verificationStatus: 'PENDING',
      currentLocation: { lat: PUNE.lat + 0.02, lng: PUNE.lng + 0.02 },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  await KycDocument.findOneAndUpdate(
    { userId: pending._id, type: 'RC' },
    { userId: pending._id, type: 'RC', fileUrl: '/uploads/seed/rc.jpg', status: 'PENDING' },
    { upsert: true, setDefaultsOnInsert: true },
  );

  // three open requests to the same mandi — the pool a transporter will see
  for (const [i, f] of [farmer, farmer2, farmer3].entries()) {
    const open = await TransportRequest.findOne({ farmerId: f._id, state: 'OPEN' });
    if (open) continue;
    await TransportRequest.create({
      farmerId: f._id,
      cropType: ['Onion', 'Tomato', 'Potato'][i],
      quantityKg: [400, 700, 500][i],
      pickup: f.defaultLocation ?? { name: 'Pimpri, Pune', ...PUNE },
      destination: LASALGAON,
      preferredDate: new Date(Date.now() + 86400000),
      state: 'OPEN',
      expiresAt: new Date(Date.now() + 24 * 3600000),
    });
  }

  // =========================================================================
  // V2 — Farm Resource Network
  //
  // Deliberately mixed supply. Two of the three providers are FARMERS who already
  // exist in this seed, because that is the product story: the tractor that works
  // twenty days a year belongs to a farmer, not to a hire company. The third is a
  // custom-hiring centre, which is how a combine harvester is actually reached.
  // =========================================================================

  const hiringCentre = await upsertUser('9000000008', {
    name: 'Krishi Seva Kendra',
    role: 'FARMER',
    language: 'mr',
    defaultLocation: { name: 'Manchar', lat: 19.0038, lng: 73.9403 },
  });

  const MACHINES = [
    {
      owner: farmer, // Rahul's own tractor — idle most of the year
      category: 'TRACTOR_TROLLEY' as const,
      title: 'Mahindra 575 with trolley',
      makeModel: 'Mahindra 575 DI',
      operatorMode: 'WITH_OPERATOR' as const,
      attachments: ['Trolley', 'Cage wheels'],
      base: { name: 'Pimpri, Pune', ...PUNE },
      radius: 30,
      pricing: { unit: 'PER_HOUR' as const, rate: 650, minimumCharge: 1300, travelRatePerKm: 18 },
    },
    {
      owner: farmer3, // Sanjay hires his rotavator out between his own seasons
      category: 'ROTAVATOR' as const,
      title: 'Rotavator — 7 feet',
      makeModel: 'Shaktiman 7ft',
      operatorMode: 'WITH_OPERATOR' as const,
      attachments: [],
      base: { name: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389 },
      radius: 22,
      pricing: { unit: 'PER_ACRE' as const, rate: 1100, minimumCharge: 2200, travelRatePerKm: 15 },
    },
    {
      owner: hiringCentre,
      category: 'COMBINE_HARVESTER' as const,
      title: 'Combine harvester — wheat & soybean',
      makeModel: 'John Deere W70',
      operatorMode: 'WITH_OPERATOR' as const,
      attachments: ['Grain tank', 'Straw spreader'],
      base: { name: 'Manchar', lat: 19.0038, lng: 73.9403 },
      radius: 60,
      pricing: { unit: 'PER_ACRE' as const, rate: 2400, minimumCharge: 4800, travelRatePerKm: 40 },
    },
    {
      owner: hiringCentre,
      category: 'TRACTOR_TROLLEY' as const,
      title: 'Swaraj 744 with trolley',
      makeModel: 'Swaraj 744 FE',
      operatorMode: 'EITHER' as const,
      attachments: ['Trolley'],
      base: { name: 'Manchar', lat: 19.0038, lng: 73.9403 },
      radius: 45,
      pricing: { unit: 'PER_HOUR' as const, rate: 700, minimumCharge: 1400, travelRatePerKm: 22 },
    },
    {
      owner: hiringCentre,
      category: 'THRESHER' as const,
      title: 'Multi-crop thresher',
      operatorMode: 'WITH_OPERATOR' as const,
      attachments: [],
      base: { name: 'Manchar', lat: 19.0038, lng: 73.9403 },
      radius: 35,
      pricing: { unit: 'PER_DAY' as const, rate: 5200, minimumCharge: 5200, travelRatePerKm: 25 },
    },
  ];

  for (const m of MACHINES) {
    await FarmMachine.findOneAndUpdate(
      { ownerId: m.owner._id, title: m.title },
      {
        ownerId: m.owner._id,
        category: m.category,
        title: m.title,
        makeModel: m.makeModel,
        operatorMode: m.operatorMode,
        attachments: m.attachments,
        baseLocation: m.base,
        serviceRadiusKm: m.radius,
        pricing: m.pricing,
        status: 'LISTED',
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  /*
   * SCENARIO B — several farmers wanting a harvester in the same week.
   *
   * These are real REQUESTED bookings, so they do two jobs at once: they populate
   * the provider's inbox, and they are what `demandClusters` counts. Without them
   * the aggregation endpoint returns an honest empty array and the feature cannot
   * be demonstrated.
   */
  const harvester = await FarmMachine.findOne({ category: 'COMBINE_HARVESTER' });
  if (harvester) {
    const day = 86_400_000;
    const cluster = [
      { who: farmer2, acres: 4, inDays: 3, place: 'Chinchwad, Pune', lat: 18.6298, lng: 73.7997 },
      { who: farmer3, acres: 6, inDays: 4, place: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389 },
    ];

    for (const c of cluster) {
      const exists = await MachineBooking.findOne({ machineId: harvester._id, farmerId: c.who._id });
      if (exists) continue;

      const start = new Date(Date.now() + c.inDays * day);
      start.setHours(7, 0, 0, 0);
      const end = new Date(start.getTime() + 6 * 3_600_000);

      // priced by the same engine the API uses — a seed must never invent money
      const travelKm = 30;
      const workCost = c.acres * harvester.pricing.rate;
      const travelCost = travelKm * 2 * harvester.pricing.travelRatePerKm;
      const total = Math.max(workCost + travelCost, harvester.pricing.minimumCharge);

      await MachineBooking.create({
        machineId: harvester._id,
        providerId: harvester.ownerId,
        farmerId: c.who._id,
        category: harvester.category,
        operatorMode: 'WITH_OPERATOR',
        window: { start, end },
        location: { name: c.place, lat: c.lat, lng: c.lng },
        workType: 'Wheat harvesting',
        areaAcres: c.acres,
        state: 'REQUESTED',
        quote: {
          unit: harvester.pricing.unit,
          rate: harvester.pricing.rate,
          billableUnits: c.acres,
          workCost,
          travelKm,
          travelCost,
          minimumTopUp: Math.max(0, harvester.pricing.minimumCharge - (workCost + travelCost)),
          total,
          platformFee: Math.round(total * 0.1 * 100) / 100,
          providerEarning: Math.round(total * 0.9 * 100) / 100,
        },
        startOtp: String(1000 + Math.floor(Math.random() * 9000)),
      });
    }
  }

  // =========================================================================
  // V2 — Backhaul Network
  //
  // SCENARIO C. Every one of these starts AT or near Lasalgaon and ends back
  // toward Pune, which is precisely the empty leg a truck drives after dropping
  // produce at the mandi. Categories are mixed on purpose so the eligibility
  // rules have something to actually reject: a TRACTOR can take the empty crates
  // and none of the rest.
  // =========================================================================

  const RETURN_LOADS = [
    {
      requester: hiringCentre,
      cargoCategory: 'GROCERY_RETAIL' as const,
      description: 'Kirana shop restock — rice, oil, pulses',
      weightKg: 900,
      pickup: { name: 'Lasalgaon Market', lat: 20.1465, lng: 74.2405 },
      destination: { name: 'Manchar', lat: 19.0038, lng: 73.9403 },
      hours: 8,
    },
    {
      requester: farmer2,
      cargoCategory: 'EMPTY_CRATES' as const,
      description: 'Empty onion crates going back to the village',
      weightKg: 300,
      pickup: { ...LASALGAON },
      destination: { name: 'Chinchwad, Pune', lat: 18.6298, lng: 73.7997 },
      hours: 10,
    },
    {
      requester: farmer3,
      cargoCategory: 'AGRI_INPUTS' as const,
      description: 'Seed and packaged soil inputs from the agri store',
      weightKg: 1400,
      pickup: { name: 'Niphad', lat: 20.0806, lng: 74.1097 },
      destination: { name: 'Hinjewadi, Pune', lat: 18.5913, lng: 73.7389 },
      hours: 12,
    },
    {
      requester: hiringCentre,
      cargoCategory: 'ANIMAL_FEED' as const,
      description: 'Cattle feed sacks for the dairy co-operative',
      weightKg: 2200,
      pickup: { name: 'Lasalgaon', lat: 20.1502, lng: 74.2321 },
      destination: { name: 'Narayangaon', lat: 19.0742, lng: 73.9375 },
      hours: 9,
    },
  ];

  for (const load of RETURN_LOADS) {
    const exists = await BackhaulRequest.findOne({
      requesterId: load.requester._id,
      description: load.description,
    });
    if (exists) continue;

    await BackhaulRequest.create({
      requesterId: load.requester._id,
      cargoCategory: load.cargoCategory,
      description: load.description,
      weightKg: load.weightKg,
      pickup: load.pickup,
      destination: load.destination,
      readyFrom: new Date(Date.now() - 3_600_000),
      readyUntil: new Date(Date.now() + load.hours * 3_600_000),
      state: 'OPEN',
    });
  }

  console.log(`
Seeded${RESET ? ' (after reset)' : ' (nothing deleted)'}.

  Farmers       9000000001 Rahul Patil    (Marathi)
                9000000006 Ganesh More
                9000000007 Sanjay Deshmukh
  Transporters  9000000002 / 9000000003 / 9000000004  (verified)
                9000000005  (KYC pending — sees no pool)

  3 open requests to Lasalgaon Mandi are waiting in the pool — enough for one
  4-tonne truck to claim all three and show pooled pricing.

  V2 · Farm Resource Network
  Providers     9000000001 Rahul Patil        (his own tractor + trolley)
                9000000007 Sanjay Deshmukh    (rotavator)
                9000000008 Krishi Seva Kendra (harvester, tractor, thresher)
  5 machines listed. 2 farmers already want the harvester the same week, so the
  demand-cluster endpoint has a real cluster to report.

  V2 · Backhaul Network
  4 open return loads from around Lasalgaon back toward Pune — grocery, empty
  crates, agri inputs and cattle feed. Only the crates are eligible for a tractor,
  so the cargo rules have something to refuse.

OTP codes print to the server console in demo mode.
`);

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
