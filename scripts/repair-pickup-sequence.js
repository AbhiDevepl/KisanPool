/**
 * One-off repair: pickup sequences were written 1-based while every screen
 * renders `pickupSequence + 1`, so a driver's first pickup read "#2".
 * Normalises each trip's shipments to 0..n-1 in the order they were confirmed.
 * Pass --apply to write; without it this only reports.
 */
const base='/home/devx/Development/kisanpool/project';
require(base+'/node_modules/dotenv').config({path:base+'/.env'});
const mongoose=require(base+'/node_modules/mongoose');
const APPLY=process.argv.includes('--apply');

(async()=>{
  await mongoose.connect(process.env.MONGODB_URI, {
    writeConcern: { w: 'majority' }, retryWrites: true, retryReads: true,
    serverSelectionTimeoutMS: 8000,
  });
  const db=mongoose.connection.db;
  const trips=await db.collection('tripshipments').distinct('tripId');
  let trips_touched=0, rows=0;

  for(const tripId of trips){
    const ships=await db.collection('tripshipments')
      .find({tripId}).sort({pickupSequence:1,createdAt:1}).toArray();
    const wrong=ships.some((s,i)=>s.pickupSequence!==i);
    if(!wrong) continue;
    trips_touched++;
    console.log(`trip ${tripId}: [${ships.map(s=>s.pickupSequence).join(',')}] -> [${ships.map((_,i)=>i).join(',')}]`);
    for(const [i,s] of ships.entries()){
      if(s.pickupSequence===i) continue;
      rows++;
      if(APPLY) await db.collection('tripshipments').updateOne({_id:s._id},{$set:{pickupSequence:i}});
    }
  }
  console.log(`\n${APPLY?'REPAIRED':'WOULD REPAIR'}: ${rows} shipment(s) across ${trips_touched} trip(s)`);
  await mongoose.disconnect();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
