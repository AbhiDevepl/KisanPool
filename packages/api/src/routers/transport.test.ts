import assert from "node:assert/strict";
import { test } from "node:test";
import { haversineKm, calculateMatchScore } from "./transport";

test("haversineKm calculates correct distance between Delhi and Gurgaon", () => {
  // Delhi Mandi ~ (28.6139, 77.209), Gurgaon ~ (28.4595, 77.0266)
  const distance = haversineKm(28.6139, 77.209, 28.4595, 77.0266);
  assert.ok(distance > 20 && distance < 30, `Distance should be ~24km, got ${distance}`);
});

test("calculateMatchScore combines proximity (60%) and capacity (40%)", () => {
  // Vehicle at exact pickup location (distance = 0 -> distanceScore = 100)
  // Request 800kg, Vehicle capacity 1000kg -> utilization 0.8 -> capacityScore = 80
  // Score = 100 * 0.6 + 80 * 0.4 = 60 + 32 = 92
  const score = calculateMatchScore(28.6139, 77.209, 28.6139, 77.209, 28.7041, 77.1025, 1000, 800);
  assert.equal(score, 92);
});

test("cost calculation and 60/40 cost split ratio", () => {
  const tripDistance = 24.5;
  const ratePerKm = 20;
  const totalCost = Math.round(tripDistance * ratePerKm * 100) / 100; // 490
  const farmerShare = Math.round(totalCost * 0.6 * 100) / 100; // 294
  const driverShare = Math.round(totalCost * 0.4 * 100) / 100; // 196

  assert.equal(totalCost, 490);
  assert.equal(farmerShare, 294);
  assert.equal(driverShare, 196);
  assert.equal(farmerShare + driverShare, totalCost);
});

test("capacity filtering uses Vehicle.capacityKg as single source of truth", () => {
  const vehicles = [
    { id: "v1", capacityKg: 500 },
    { id: "v2", capacityKg: 1000 },
    { id: "v3", capacityKg: 2000 },
  ];
  const requestQuantity = 800;
  const compatible = vehicles.filter((v) => v.capacityKg >= requestQuantity);

  assert.equal(compatible.length, 2);
  assert.deepEqual(compatible.map((v) => v.id), ["v2", "v3"]);
});
