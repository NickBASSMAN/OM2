export function parseChaturbateRoom(room) {
  return {
    id: `chaturbate:${room.username}`,
    site: "chaturbate",

    username: room.username,
    displayName: room.username,

    profileUrl: `https://chaturbate.com/${room.username}/`,
    thumbnailUrl: room.img,

    status: {
      online: true, // якщо є в room-list → онлайн
      showType: room.current_show || "public",
      lastSeen: Date.now(),
      viewers: room.num_users || 0
    },

    stream: {
      title: room.room_subject || "",
      tags: room.tags || [],
      showType: room.current_show || "public",
      isPrivate: room.current_show === "private",
      isGroup: room.current_show === "group"
    },

    pricing: {
      tokensPerMinute: room.spy_show_price || 0,
      privatePrice: room.private_price || 0
    },

    platformData: {
      gender: room.gender,
      location: room.location,
      country: room.country,
      followers: room.num_followers,
      startedAt: room.start_dt_utc,
      isNew: room.is_new
    },

    tracking: {
      addedAt: 0,
      updatedAt: Date.now(),
      favorite: false
    }
  };
}