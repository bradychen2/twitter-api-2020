
const { Message, User } = require('../models')

let onlineUser = []

module.exports = (server) => {
  const io = require('socket.io')(server, {
    cors: {
      origin: ['https://fogjogger1992.github.io', 'http://localhost:8080'],
      methods: ['GET', 'POST'],
      transports: ['websocket', 'polling'],
      credentials: true
    },
    allowEIO3: true
  })

  // 連線錯誤監聽
  io.on('connect_error', (err, next) => {
    console.log(`connect_error due to ${err.message}`)
    next(err)
  })

  // 連線監聽
  io.on('connection', (socket) => {
    console.log('socket server connected')
    // 接收 current user 回傳 onlineUser array
    socket.on('newUser', async user => {
      try {
        console.log('new user join chatroom')

        socket.user = user
        const userIdList = onlineUser.map(user => {
          return user.id
        })
        // 不重複的使用者才加進 LIST
        if (!userIdList.includes(user.id)) {
          onlineUser.push(user)
        }

        // 請求 new user socket
        io.to(socket.id).emit('newUser', user)
        io.emit('onlineUser', onlineUser)
        socket.broadcast.emit('userJoin', socket.user)

        // 發送之前的全部訊息
        const msgs = await Message.findAll({
          raw: true,
          nest: true,
          where: { isPublic: true },
          include: [{
            model: User,
            attributes: ['id', 'name', 'account', 'avatar'],
            as: 'Sender'
          }],
          order: [['createdAt', 'ASC']]
        })
        io.to(socket.id).emit('historyMessages', msgs)
      } catch (err) {
        console.log(err)
      }
    })

    // 公開訊息監聽
    socket.on('sendMessage', async (msg) => {
      try {
        // 前端傳來的訊息為空 return
        if (!msg.content) return
        // 取得 sender id
        const senderId = socket.user.id
        if (!senderId) return

        const { content, isPublic } = msg
        // 新訊息放進資料庫
        let message = await Message.create({
          senderId,
          content,
          isPublic
        })
        message = message.toJSON()
        message = await Message.findAll({
          raw: true,
          nest: true,
          where: { id: message.id },
          include: [{
            model: User,
            attributes: ['id', 'name', 'account', 'avatar'],
            as: 'Sender'
          }]
        })
        // 傳新訊息給所有人
        io.emit('newMessage', message)
        console.log('message: ' + msg)
      } catch (err) {
        console.log(err)
      }
    })

    // 離線監聽
    socket.on('leavingChatroom', () => {
      // 離開時減少聊天室人數並發送給網頁
      onlineUser = onlineUser.filter(user => user.id !== socket.user.id)
      io.emit('onlineUser', onlineUser)
      io.emit('userLeave', socket.user)
      console.log('a user left chatroom')
    })
    socket.on('disconnect', () => {
      console.log('disconnected')
    })
  })
}
