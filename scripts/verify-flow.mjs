#!/usr/bin/env node

/**
 * KisanPool End-to-End Smoke Test Script
 * Exercises full flow over HTTP:
 * 1. Health check
 * 2. Seed vehicles
 * 3. Create transport request
 * 4. Find compatible top-3 matches
 * 5. Accept top match
 * 6. Verify match record & state transitions
 * 7. Verify guard against double acceptance
 */

const BASE_URL = process.env.SERVER_URL || "http://localhost:3000";

async function run() {
  console.log(`\n🚀 Starting KisanPool End-to-End Verification against ${BASE_URL}...\n`);

  try {
    // 1. Health Check
    console.log("1️⃣ Checking API Health...");
    const healthRes = await fetch(`${BASE_URL}/`);
    const healthText = await healthRes.text();
    if (healthRes.status !== 200 || healthText !== "OK") {
      throw new Error(`Health check failed: status ${healthRes.status}, body: ${healthText}`);
    }
    console.log("   ✓ API Server is LIVE and returning 200 OK");

    // 2. Seed Demo Vehicles
    console.log("\n2️⃣ Seeding Demo Vehicles...");
    const seedRes = await fetch(`${BASE_URL}/trpc/transport.seedVehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const seedJson = await seedRes.json();
    const count = seedJson.result?.data?.count ?? 0;
    console.log(`   ✓ Seeded ${count} vehicles into SQLite database`);

    // 3. Create Transport Request
    console.log("\n3️⃣ Creating Transport Request...");
    const createRes = await fetch(`${BASE_URL}/trpc/transport.createRequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        farmerId: "farmer-verify-1",
        cropType: "Wheat",
        quantityKg: 800,
        pickupLat: 28.6139,
        pickupLng: 77.209,
        dropoffLat: 28.7041,
        dropoffLng: 77.1025,
        pickupAddress: "Delhi Mandi",
        dropoffAddress: "Gurgaon Warehouse",
        preferredDate: new Date().toISOString(),
      }),
    });
    const createJson = await createRes.json();
    const request = createJson.result?.data;
    if (!request || !request.id) {
      throw new Error(`Failed to create request: ${JSON.stringify(createJson)}`);
    }
    console.log(`   ✓ Transport Request created with ID: ${request.id}`);

    // 4. Find Matches
    console.log("\n4️⃣ Finding Compatible Matches...");
    const inputParam = encodeURIComponent(JSON.stringify({ requestId: request.id }));
    const findRes = await fetch(`${BASE_URL}/trpc/transport.findMatches?input=${inputParam}`);
    const findJson = await findRes.json();
    const matches = findJson.result?.data?.matches;
    if (!Array.isArray(matches) || matches.length === 0) {
      throw new Error(`No matches found: ${JSON.stringify(findJson)}`);
    }
    console.log(`   ✓ Found ${matches.length} compatible vehicle match(es)`);
    const topMatch = matches[0];
    console.log(`   🏆 Top Match: ${topMatch.vehicle.driverName} (${topMatch.vehicle.vehicleType})`);
    console.log(`      Score: ${topMatch.matchScore}/100 | Distance: ${topMatch.distanceKm} km`);
    console.log(`      Total Cost: ₹${topMatch.totalCost} | Farmer: ₹${topMatch.farmerShare} (60%) | Driver: ₹${topMatch.driverShare} (40%)`);

    // 5. Accept Match
    console.log("\n5️⃣ Accepting Top Match...");
    const acceptRes = await fetch(`${BASE_URL}/trpc/transport.acceptMatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.id,
        vehicleId: topMatch.vehicle.id,
      }),
    });
    const acceptJson = await acceptRes.json();
    const matchRecord = acceptJson.result?.data;
    if (!matchRecord || !matchRecord.id) {
      throw new Error(`Failed to accept match: ${JSON.stringify(acceptJson)}`);
    }
    console.log(`   ✓ Match accepted successfully! Match Record ID: ${matchRecord.id}`);

    // 6. Verify Match Record & State Transitions
    console.log("\n6️⃣ Verifying Database State Transitions...");
    const matchInput = encodeURIComponent(JSON.stringify({ matchId: matchRecord.id }));
    const getMatchRes = await fetch(`${BASE_URL}/trpc/transport.getMatch?input=${matchInput}`);
    const getMatchJson = await getMatchRes.json();
    const verifiedMatch = getMatchJson.result?.data;
    if (!verifiedMatch) {
      throw new Error(`Failed to retrieve match record: ${JSON.stringify(getMatchJson)}`);
    }

    if (verifiedMatch.request.status !== "MATCHED") {
      throw new Error(`Expected request status MATCHED, got: ${verifiedMatch.request.status}`);
    }
    if (verifiedMatch.vehicle.isAvailable !== false) {
      throw new Error(`Expected vehicle isAvailable false, got: ${verifiedMatch.vehicle.isAvailable}`);
    }
    console.log("   ✓ Verified Request status updated to 'MATCHED'");
    console.log("   ✓ Verified Vehicle isAvailable set to false");

    // 7. Verify Double Acceptance Guard
    console.log("\n7️⃣ Verifying Duplicate Match Acceptance Guard...");
    const dupRes = await fetch(`${BASE_URL}/trpc/transport.acceptMatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.id,
        vehicleId: topMatch.vehicle.id,
      }),
    });
    const dupJson = await dupRes.json();
    if (!dupJson.error) {
      throw new Error("Expected duplicate acceptMatch call to fail, but it succeeded!");
    }
    console.log("   ✓ Duplicate match attempt properly rejected with error.");

    console.log("\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!\n");
  } catch (err) {
    console.error(`\n❌ Verification failed: ${err.message}`);
    process.exit(1);
  }
}

run();
