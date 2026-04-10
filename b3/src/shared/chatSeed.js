function createSeedState(user) {
  const now = Date.now();

  return {
    chats: [
      {
        chatId: 'direct::101',
        chatType: 'direct',
        title: 'Nenu Natho',
        subtitle: '@nenu',
        avatarText: 'N',
        unreadCount: 2,
        muted: false,
        lastMessage: {
          messageId: 'm-101-3',
          text: 'And after that we can plug Android into the same endpoints.',
          sentAt: new Date(now - 1000 * 60 * 12).toISOString(),
          direction: 'incoming',
          status: 'delivered'
        }
      },
      {
        chatId: 'direct::102',
        chatType: 'direct',
        title: 'Books',
        subtitle: '@books',
        avatarText: 'B',
        unreadCount: 0,
        muted: false,
        lastMessage: {
          messageId: 'm-102-2',
          text: 'Yes. No full-history load and no hidden N+1 queries.',
          sentAt: new Date(now - 1000 * 60 * 25).toISOString(),
          direction: 'outgoing',
          status: 'read'
        }
      },
      {
        chatId: 'channel::103',
        chatType: 'channel',
        title: 'Announcements',
        subtitle: 'System channel',
        avatarText: 'A',
        unreadCount: 1,
        muted: false,
        lastMessage: {
          messageId: 'm-103-1',
          text: 'Welcome to V3. This thread is still demo data, but the shape is now clean.',
          sentAt: new Date(now - 1000 * 60 * 45).toISOString(),
          direction: 'incoming',
          status: 'delivered'
        }
      }
    ],
    messagesByChatId: {
      'direct::101': [
        {
          messageId: 'm-101-1',
          direction: 'incoming',
          senderDisplayName: 'Nenu Natho',
          text: 'We have the V3 auth loop working.',
          sentAt: new Date(now - 1000 * 60 * 16).toISOString(),
          status: 'delivered'
        },
        {
          messageId: 'm-101-2',
          direction: 'outgoing',
          senderDisplayName: user.displayName,
          text: 'Good. Next we keep the thread contract small and predictable.',
          sentAt: new Date(now - 1000 * 60 * 14).toISOString(),
          status: 'read'
        },
        {
          messageId: 'm-101-3',
          direction: 'incoming',
          senderDisplayName: 'Nenu Natho',
          text: 'And after that we can plug Android into the same endpoints.',
          sentAt: new Date(now - 1000 * 60 * 12).toISOString(),
          status: 'delivered'
        }
      ],
      'direct::102': [
        {
          messageId: 'm-102-1',
          direction: 'incoming',
          senderDisplayName: 'Books',
          text: 'Keep the chat list query lean from the start.',
          sentAt: new Date(now - 1000 * 60 * 28).toISOString(),
          status: 'delivered'
        },
        {
          messageId: 'm-102-2',
          direction: 'outgoing',
          senderDisplayName: user.displayName,
          text: 'Yes. No full-history load and no hidden N+1 queries.',
          sentAt: new Date(now - 1000 * 60 * 25).toISOString(),
          status: 'read'
        }
      ],
      'channel::103': [
        {
          messageId: 'm-103-1',
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
