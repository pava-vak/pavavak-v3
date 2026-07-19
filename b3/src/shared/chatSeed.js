// Demo contact user IDs — high range to avoid collisions with real users
const DEMO_CONTACT_A = 9001; // "Alex" demo contact
const DEMO_CONTACT_B = 9002; // "Books" demo contact
const DEMO_CHANNEL   = 9003; // system channel user

function directId(a, b) {
  const [lo, hi] = [Number(a), Number(b)].sort((x, y) => x - y);
  return `direct::${lo}:${hi}`;
}

function createSeedState(user) {
  const uid = user.userId;
  const now = Date.now();

  const chatA  = directId(uid, DEMO_CONTACT_A);
  const chatB  = directId(uid, DEMO_CONTACT_B);
  const chatCh = 'channel::9003';

  // Per-user message IDs so concurrent seeds don't conflict
  const mA1 = `m-${uid}-a1`;
  const mA2 = `m-${uid}-a2`;
  const mA3 = `m-${uid}-a3`;
  const mB1 = `m-${uid}-b1`;
  const mB2 = `m-${uid}-b2`;
  const mC1 = `m-${uid}-c1`;

  return {
    chats: [
      {
        chatId: chatA,
        chatType: 'direct',
        contactUserId: DEMO_CONTACT_A,
        title: 'Alex',
        subtitle: '@alex',
        avatarText: 'A',
        unreadCount: 2,
        muted: false,
        lastMessage: {
          messageId: mA3,
          text: 'And after that we can plug Android into the same endpoints.',
          sentAt: new Date(now - 1000 * 60 * 12).toISOString(),
          direction: 'incoming',
          status: 'delivered'
        }
      },
      {
        chatId: chatB,
        chatType: 'direct',
        contactUserId: DEMO_CONTACT_B,
        title: 'Books',
        subtitle: '@books',
        avatarText: 'B',
        unreadCount: 0,
        muted: false,
        lastMessage: {
          messageId: mB2,
          text: 'Yes. No full-history load and no hidden N+1 queries.',
          sentAt: new Date(now - 1000 * 60 * 25).toISOString(),
          direction: 'outgoing',
          status: 'read'
        }
      },
      {
        chatId: chatCh,
        chatType: 'channel',
        contactUserId: DEMO_CHANNEL,
        title: 'Announcements',
        subtitle: 'System channel',
        avatarText: 'A',
        unreadCount: 1,
        muted: false,
        lastMessage: {
          messageId: mC1,
          text: 'Welcome to V3. This thread is still demo data, but the shape is now clean.',
          sentAt: new Date(now - 1000 * 60 * 45).toISOString(),
          direction: 'incoming',
          status: 'delivered'
        }
      }
    ],
    messagesByChatId: {
      [chatA]: [
        {
          messageId: mA1,
          direction: 'incoming',
          senderDisplayName: 'Alex',
          text: 'We have the V3 auth loop working.',
          sentAt: new Date(now - 1000 * 60 * 16).toISOString(),
          status: 'delivered'
        },
        {
          messageId: mA2,
          direction: 'outgoing',
          senderDisplayName: user.displayName,
          text: 'Good. Next we keep the thread contract small and predictable.',
          sentAt: new Date(now - 1000 * 60 * 14).toISOString(),
          status: 'read'
        },
        {
          messageId: mA3,
          direction: 'incoming',
          senderDisplayName: 'Alex',
          text: 'And after that we can plug Android into the same endpoints.',
          sentAt: new Date(now - 1000 * 60 * 12).toISOString(),
          status: 'delivered'
        }
      ],
      [chatB]: [
        {
          messageId: mB1,
          direction: 'incoming',
          senderDisplayName: 'Books',
          text: 'Keep the chat list query lean from the start.',
          sentAt: new Date(now - 1000 * 60 * 28).toISOString(),
          status: 'delivered'
        },
        {
          messageId: mB2,
          direction: 'outgoing',
          senderDisplayName: user.displayName,
          text: 'Yes. No full-history load and no hidden N+1 queries.',
          sentAt: new Date(now - 1000 * 60 * 25).toISOString(),
          status: 'read'
        }
      ],
      [chatCh]: [
        {
          messageId: mC1,
          direction: 'incoming',
          senderDisplayName: 'Announcements',
          text: 'Welcome to V3. This thread is still demo data, but the shape is now clean.',
          sentAt: new Date(now - 1000 * 60 * 45).toISOString(),
          status: 'delivered'
        }
      ]
    }
  };
}

module.exports = { createSeedState };
