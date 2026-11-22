// core plugin 入口：宿主 cored（Go build 产物，见 ../../core_system/cmd/cored）
// 职责：插件生命周期挂接 + 本地 cored 进程桥接 + connector 注册
export const name = 'dsh-plugin-core-system'
