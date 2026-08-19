// mammoth 浏览器 UMD 包（自带 jszip，树里唯一的 jsZip 解压路径），类型复用主入口 d.ts
declare module 'mammoth/mammoth.browser' {
  import mammoth = require('mammoth')
  export = mammoth
}