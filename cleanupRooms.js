const mongoose = require('mongoose');
const Room = require('./models/Room');

// Connect to MongoDB
const MONGODB_URI = 'mongodb+srv://loc285391:4ao7tgyn1A8qCEpb@sportsbooking.uyq8ouc.mongodb.net/memecard?retryWrites=true&w=majority&appName=SportsBooking';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('🍃 MongoDB Atlas connected for cleanup!'))
.catch(err => console.error('❌ MongoDB connection error:', err));

async function cleanupRooms() {
  try {
    console.log('🧹 Starting room cleanup...');
    
    // Get all rooms
    const rooms = await Room.find({});
    console.log(`Found ${rooms.length} rooms`);
    
    let cleanedRooms = 0;
    let deletedRooms = 0;
    
    for (const room of rooms) {
      console.log(`\n📋 Cleaning room ${room.roomId}:`);
      console.log(`  - Original players: ${room.players.length}`);
      
      // Remove duplicate players (same name or socketId)
      const uniquePlayers = [];
      const seenNames = new Set();
      const seenSocketIds = new Set();
      
      for (const player of room.players) {
        const isDuplicateName = seenNames.has(player.name);
        const isDuplicateSocket = seenSocketIds.has(player.socketId);
        
        if (!isDuplicateName && !isDuplicateSocket && player.name.trim() !== '') {
          uniquePlayers.push(player);
          seenNames.add(player.name);
          seenSocketIds.add(player.socketId);
        } else {
          console.log(`  - Removing duplicate/invalid: ${player.name} (${player.socketId})`);
        }
      }
      
      // Delete empty rooms or rooms with no valid players
      if (uniquePlayers.length === 0) {
        await Room.deleteOne({ _id: room._id });
        console.log(`  - ❌ Deleted empty room ${room.roomId}`);
        deletedRooms++;
      } else if (uniquePlayers.length !== room.players.length) {
        // Update room with cleaned players
        await Room.updateOne(
          { _id: room._id },
          { 
            players: uniquePlayers,
            status: 'waiting',
            currentJudge: 0,
            currentCaption: null,
            submissions: []
          }
        );
        console.log(`  - ✅ Cleaned room ${room.roomId}: ${room.players.length} → ${uniquePlayers.length} players`);
        cleanedRooms++;
      } else {
        console.log(`  - ✓ Room ${room.roomId} is already clean`);
      }
    }
    
    console.log('\n🎯 Cleanup Summary:');
    console.log(`  - Rooms cleaned: ${cleanedRooms}`);
    console.log(`  - Rooms deleted: ${deletedRooms}`);
    console.log(`  - Total processed: ${rooms.length}`);
    
    // Show remaining rooms
    const remainingRooms = await Room.find({});
    console.log('\n📊 Remaining rooms:');
    for (const room of remainingRooms) {
      console.log(`  - ${room.roomId}: ${room.players.length} players (${room.players.map(p => p.name).join(', ')})`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  } finally {
    mongoose.disconnect();
    console.log('\n✅ Cleanup completed!');
  }
}

// Run cleanup
cleanupRooms(); 