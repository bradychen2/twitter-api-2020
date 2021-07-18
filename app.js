const express = require('express')
const session = require('express-session')
const helpers = require('./_helpers');
const cors = require('cors')
const { Message, User } = require('./models')
const { Op } = require("sequelize");
const app = express()
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}
const port = process.env.PORT || 3000
// Create http server for socket.io
// const server = require('http').createServer(app)
const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`))
const io = require('socket.io')(server, {
  cors: {
    origin: "http://localhost:8080",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true
})
const passport = require('./config/passport');
const { SSL_OP_NO_TICKET } = require('constants');

// cors 的預設為全開放
app.use(cors())

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false
}))
app.use(passport.initialize())
app.use('/upload', express.static(__dirname + '/upload'))
app.use((req, res, next) => {
  req.user = helpers.getUser(req)
  next()
})

app.get('/', (req, res, next) => {
  res.sendFile(__dirname + '/view/index.html')
})

app.get('/private1', (req, res, next) => {
  res.sendFile(__dirname + '/view/private1.html')
})

app.get('/private2', (req, res, next) => {
  res.sendFile(__dirname + '/view/private2.html')
})

// 群聊在線人數
let onlineCounts = 0
let onlineUser = []

const publicNamespace = io.of("/public")
const privateNamespace = io.of("/private")

// 連線錯誤監聽
publicNamespace.on("connect_error", (err, next) => {
  console.log(`connect_error due to ${err.message}`)
  next(err)
})

// 連線監聽
publicNamespace.on('connection', async (socket) => {
  // 連線發生時發送人數給網頁
  onlineCounts += 1
  publicNamespace.emit('online', onlineCounts)
  console.log('new user connected')

  // 請求 new user socket
  publicNamespace.to(socket.id).emit('newUser')

  // 接收 current user 回傳 onlineUser array
  socket.on('newUser', userId => {
    socket.user = userId
    onlineUser.push(userId)

    console.log(onlineUser)

    publicNamespace.emit('onlineUser', onlineUser)
    socket.broadcast.emit('userJoin', socket.user)
  })

  try {
    // 發送之前的全部訊息
    const msgs = await Message.findAll({
      raw: true,
      nest: true,
      where: { isPublic: true },
      order: [
        ['createdAt', 'ASC']
      ]
    })
    console.log(msgs)
    publicNamespace.to(socket.id).emit('historyMessages', msgs)
  } catch (err) {
    console.log(err)
  }

  // 公開訊息監聽
  socket.on('sendMessage', async (msg) => {
    try {
      // 前端傳來的訊息為空 return
      if (!msg.content) return
      // 取得 sender id
      const senderId = socket.user
      if (!senderId) return

      const { content, isPublic } = msg
      // 新訊息放進資料庫
      const message = await Message.create({
        senderId,
        content,
        isPublic
      })

      // 傳新訊息給所有人
      publicNamespace.emit('newMessage', message.toJSON())
      console.log('message: ', msg)
    } catch (err) {
      console.log(err)
    }
  })

  // 離線監聽
  socket.on('disconnect', () => {
    // 離開時減少聊天室人數並發送給網頁
    onlineCounts = (onlineCounts <= 0) ? 0 : onlineCounts -= 1
    onlineUser = onlineUser.filter(user => user !== socket.data.user)
    publicNamespace.emit('online', onlineCounts)
    publicNamespace.emit('onlineUser', onlineUser)
    publicNamespace.emit('userLeave', socket.data.user)
    console.log('disconnected')
  })
})

// -------------- 私人訊息 --------------

// 連線錯誤監聽
privateNamespace.on("connect_error", (err, next) => {
  console.log(`connect_error due to ${err.message}`)
  next(err)
})

// 連線監聽
privateNamespace.on('connection', (socket) => {
  // 接收 current user 回傳 historyMessages array
  socket.on('currentUser', async (dummyUser) => {
    try {
      socket.user = dummyUser
      console.log('socket.user:', socket.user)
      socket.join(`${socket.user.id}`)
      // 找出現在使用者的全部私人訊息
      const msgs = await Message.findAll({
        raw: true,
        nest: true,
        where: {
          isPublic: false,
          [Op.or]: [
            { senderId: dummyUser.id },
            { receiverId: dummyUser.id }
          ]
        },
        order: [
          ['createdAt', 'ASC']
        ]
      })
      // 處理成依私訊對象分組的訊息
      const messagesPerUser = new Map()
      msgs.forEach(msg => {
        const { senderId, receiverId } = msg
        const otherUserId = socket.user.id === senderId ? receiverId : senderId
        if (messagesPerUser.has(otherUserId)) {
          messagesPerUser.get(otherUserId).push(msg)
        } else {
          messagesPerUser.set(otherUserId, [msg])
        }
      })
      const users = await User.findAll({
        raw: true,
        nest: true,
        where: { id: { [Op.in]: [...messagesPerUser.keys()] } },
        attributes: ['id', 'account', 'name', 'avatar']
      })
      const messageData = users.map(user => ({
        to: user,
        messages: messagesPerUser.get(user.id)
      }))
      console.log('messageData: ', messageData)
      privateNamespace.to(`${socket.user.id}`).emit('historyMessages', messageData)
    } catch (err) {
      console.log(err)
    }
  })

  // 私人訊息監聽
  socket.on('sendMessage', async (msg) => {
    try {
      // 前端傳來的訊息為空 return
      if (!msg.content) return

      const { receiverId, content } = msg
      // 新訊息放進資料庫
      const message = await Message.create({
        senderId: socket.user.id,
        receiverId,
        content,
        isPublic: false
      })

      // 傳新訊息給所有人
      privateNamespace.to(`${socket.user.id}`).to(`${receiverId}`).emit('newMessage', message.toJSON())
      console.log('message: ', message.toJSON())
    } catch (err) {
      console.log(err)
    }
  })

  // 離線監聽
  socket.on('disconnect', () => {
    // 離開時減少聊天室人數並發送給網頁
    console.log('disconnected')
  })
})

require('./routes')(app)

module.exports = app