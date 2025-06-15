# 🎮 MEME CARD GAME

Trò chơi thẻ bài meme hài hước dành cho nhiều người chơi, được xây dựng bằng Node.js, Express, Socket.io và MongoDB.

## 🎯 Tổng quan

Meme Card Game là phiên bản web của trò chơi thẻ bài phổ biến "What Do You Meme?". Người chơi sẽ tạo ra những combo meme hài hước bằng cách ghép các thẻ caption với hình ảnh meme template.

### 🎲 Cách chơi
- **3-8 người chơi** tham gia mỗi phòng
- Người **Judge** hiển thị 1 meme template
- Người chơi khác chọn 1 **caption card** phù hợp nhất
- Judge chọn combo hài hước nhất → người đó được 1 điểm
- **Đầu tiên đạt 7 điểm thắng cuộc!**

## 🚀 Cài đặt và Chạy

### Yêu cầu hệ thống
- Node.js (>= 16.0.0)
- MongoDB (local hoặc cloud)
- NPM hoặc Yarn

### 1. Clone dự án
```bash
git clone <repo-url>
cd meme-card-game
```

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Cấu hình MongoDB
- Project đã được cấu hình sẵn với MongoDB Atlas
- Database sẽ tự động tạo collection `memecard`
- Nếu muốn sử dụng MongoDB URI khác, thay đổi trong `server.js` và `seedData.js`

### 4. Tạo dữ liệu mẫu
```bash
node seedData.js
```

### 5. Chạy ứng dụng
```bash
# Development mode
npm run dev

# Production mode  
npm start
```

### 6. Truy cập game
Mở trình duyệt và vào: `http://localhost:3000`

## 🏗️ Cấu trúc dự án

```
meme-card-game/
├── models/              # MongoDB schemas
│   ├── Room.js         # Game room model
│   ├── Player.js       # Player profile model  
│   ├── MemeTemplate.js # Meme image templates
│   └── Caption.js      # Caption cards
├── public/             # Frontend files
│   ├── index.html      # Landing page
│   └── game.html       # Game interface
├── server.js           # Main server & Socket.io
├── seedData.js         # Database seeding script
├── package.json        # Dependencies & scripts
└── How_to_play.md      # Detailed game rules
```

## 🎮 Tính năng

### ✅ Đã hoàn thành
- [x] Tạo/Tham gia phòng chơi với mã code
- [x] Multiplayer real-time với Socket.io  
- [x] Hệ thống Judge xoay vòng
- [x] Hiển thị meme templates và caption cards
- [x] Tính điểm và điều kiện thắng
- [x] Chat trong game
- [x] Responsive design cho mobile
- [x] Database với MongoDB
- [x] Dữ liệu meme và caption tiếng Việt

### 🔄 Đang phát triển
- [ ] Hệ thống đăng ký/đăng nhập
- [ ] Thống kê người chơi
- [ ] Badges và achievements
- [ ] Admin panel để quản lý content
- [ ] Sound effects và animations
- [ ] Multiple game modes (Easy/Hard/Team)

### 💡 Ý tưởng tương lai
- [ ] AI Judge mode
- [ ] Custom meme upload
- [ ] Tournament system
- [ ] Ranking leaderboard
- [ ] Mobile app version

## 🎨 Công nghệ sử dụng

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **Socket.io** - Real-time communication
- **MongoDB** - NoSQL database
- **Mongoose** - MongoDB ODM

### Frontend  
- **HTML5/CSS3** - Markup & styling
- **Vanilla JavaScript** - Client-side logic
- **Socket.io Client** - Real-time features
- **Font Awesome** - Icons
- **Google Fonts** - Typography

## 🎯 API & Socket Events

### Socket Events
- `createRoom` - Tạo phòng mới
- `joinRoom` - Tham gia phòng
- `startGame` - Bắt đầu trò chơi
- `submitCard` - Gửi caption card
- `judgeSelection` - Judge chọn người thắng
- `chatMessage` - Gửi tin nhắn

### Game Flow
1. Player tạo/join room
2. Host start game khi đủ 3+ người
3. System deal 7 caption cards cho mỗi người
4. Judge hiển thị meme template
5. Players submit caption cards
6. Judge chọn combo hay nhất
7. Winner nhận điểm, next Judge
8. Repeat until someone reaches 7 points

## 🔧 Development

### Chạy development mode
```bash
npm run dev
```

### Thêm meme templates mới
1. Chỉnh sửa `seedData.js`
2. Thêm object vào array `memeTemplates`
3. Chạy lại: `node seedData.js`

### Thêm caption cards mới  
1. Chỉnh sửa `seedData.js`
2. Thêm object vào array `captions`
3. Chạy lại: `node seedData.js`

## 🐛 Troubleshooting

### MongoDB connection error
- Kiểm tra MongoDB service đã chạy
- Verify connection string
- Check firewall/network settings

### Port already in use
```bash
# Thay đổi port trong server.js hoặc kill process
lsof -ti:3000 | xargs kill -9
```

### Cards không hiển thị
- Chạy lại seed script: `node seedData.js`
- Check MongoDB có data chưa

## 🤝 Đóng góp

1. Fork dự án
2. Tạo feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Tạo Pull Request

## 📄 License

Dự án này được phát hành dưới [MIT License](LICENSE).

## 🎉 Credits

- Meme templates từ [imgflip.com](https://imgflip.com)
- Icons từ [Font Awesome](https://fontawesome.com)
- Fonts từ [Google Fonts](https://fonts.google.com)

---

## 🎮 Sẵn sàng chơi?

**Khởi chạy server và tạo phòng đầu tiên ngay thôi!** 

Invite bạn bè và cùng tạo ra những combo meme hài hước nhất! 😄

---

Made with ❤️ for Vietnamese meme lovers 