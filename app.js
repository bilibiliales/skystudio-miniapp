App({
  globalData: {
    isDarkMode: false
  },
  
  onLaunch() {
    // 读取本地存储的主题设置
    const theme = wx.getStorageSync('panelTheme');
    if (theme) {
      this.globalData.isDarkMode = theme === 'dark';
    }
  }
})
