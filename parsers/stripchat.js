export function parseStripchatRoom(room) {
  return {
    id: `stripchat:${room.username}`,
    site: "stripchat",
    username: room.username,
    displayName: room.displayName || room.username,
    profileUrl: `https://stripchat.com/${room.username}`,
    thumbnailUrl: room.thumbnailUrl || room.img || "",
    status: {
      online: Boolean(room.online),
      showType: room.showType || (room.online ? "public" : "offline"),
      roomStatus: room.roomStatus || room.showType || (room.online ? "public" : "offline"),
      lastSeen: Date.now(),
      viewers: room.viewers || 0
    },
    stream: {
      title: room.title || "",
      tags: room.tags || [],
      showType: room.showType || "public"
    },
    pricing: {},
    platformData: { ...room.platformData },
    tracking: {
      addedAt: 0,
      updatedAt: Date.now(),
      favorite: false
    }
  };
}
