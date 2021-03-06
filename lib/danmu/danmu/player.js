module.exports = {
	init: function(DD) {
		/**
		 * 已经审核过的安全Url缓存
		 * @type {Array}
		 */
		var safeUrl = [];
		/**
		 * Player对象，弹幕播放器控件。
		 * @constructor
		 * @param {Integer} v_id A video id
		 * @param {DOMElement} v_el The video node
		 */
		DD.Player = function(v_id, v_el, v_config) {
			this.video_id = v_id;
			this.video = v_el;
			this.isFullscreen = false;
			this.isTrueFullscreen = false;
			//绘制canvas相关的组件
			this.canvas = null;
			this.frame = null;
			//存放解析好的弹幕内容
			this.danmus = [];
			//连接到实时弹幕服务器的websocket	
			this.ws = null;
			this.config = v_config;
		};

		DD.Player.prototype = {
			constructor: DD.Player,
			/**
			 * 异步初始化方法，在video的元数据获取到后再初始化。
			 * 避免video的offsetWidth和offsetHeight在初始化时为空，导致canvas的长宽和video不匹配。
			 */
			init: function(canvas_id, url, wsUrl) {
				var that = this;
				that.setup(canvas_id, url, wsUrl);
			},
			/**
			 * 控制弹幕
			 * @param action
			 *
			 */
			controlDanmu: function(action) {
				if (action == 'play') {
					this.frame.begin();
				} else if (action == 'stop') {
					this.frame.stop();
					this.frame.clearDanmu();
					this.frame.render();
				} else if (action == 'update') {
					this.addDanmu();
				}
			},
			/**
			 * 初始化方法
			 * @param url 初次load弹幕的url[ajax]
			 * @param wsUrl 如果设置了wsUrl，并且浏览器支持，则建立ws链接，通过wsUrl获取实时弹幕。
			 */
			setup: function(canvas_id, url, wsUrl) {
				//初始化绘制canvas相关的组件
				var w = this.videoOriginWidth = this.video.offsetWidth; //控件的宽
				var h = this.videoOriginHeight = this.video.offsetHeight; //控件的高
				this.canvas = this.addCanvasElement(canvas_id, w, h);
				//将canvas插入到video元素前
				this.video.parentNode.insertBefore(this.canvas, this.video);

				var canvasContext = this.canvas.getContext("2d");
				this.frame = new DD.CommentFrame(w, h, canvasContext);

				var that = this;

				window.document.addEventListener("webkitfullscreenchange", function() {
					that.fullscreen();
				}, false);
				window.addEventListener('resize', function(e) {
					if (that.isFullscreen && !that.isTrueFullscreen)
						that.updateFullscreen();
				}, false);

			},
			/**
			 * 创建canvas元素
			 */
			addCanvasElement: function(canvas_id, width, height) {
				var e = window.document.createElement("canvas");
				e.id = canvas_id;
				e.style.position = "absolute";
				e.style.zIndex = "1000000";
				e.style.display = "block";
				//e.style.right = "0px";
				//e.style.top = "0px";
				e.width = width;
				e.height = height;
				return e;
			},
			/**
			 * 将从服务器取得所有弹幕的内容，进行解析，放入this.danmus
			 */
			parseDanmus: function(jsonResp, scope) {
				var nowTime = (new Date()).valueOf();
				scope.danmus = [];
				for (var i = 0; i < jsonResp.length; i++) {
					var danmu = jsonResp[i];

					// 先检测图片弹幕
					if (config.display.image) {
						if (!checkUrlValidate(danmu.text)) continue;
					}
					danmu.font = danmu.textStyle;
					danmu.lifeTime4TimeStamp = danmu.lifeTime * 1000 / 60;
					danmu.addTime = nowTime;
					danmu.height = parseInt(danmu.height);
					danmu.lifeTime = parseInt(danmu.lifeTime);
					scope.danmus.push(danmu);
				}

				function checkUrlValidate(content) {
					var regex = config.image.regex;
					regex.lastIndex = 0;
					var path = require("path");
					var fs = require("fs");
					var url = require("url");
					var ret = null;
					while ((ret = regex.exec(content)) !== null) {
						var unbelieveUrl = ret[2];
						if (safeUrl[unbelieveUrl]) continue; // 加载缓存
						var parsedUrl = url.parse(unbelieveUrl);
						if (parsedUrl.protocol) { // 如果是网络协议就检查白名单
							return !(config.image.whitelist.indexOf(unbelieveUrl) < 0);
						}
						var safePath = path.join("/", unbelieveUrl);
						var filePath = path.resolve("./", "." + safePath);
						var unsafePath = path.resolve(unbelieveUrl);
						if (filePath != unsafePath) return false; // 文件在上级目录或其他目录，判定为非法
						if (!fs.existsSync(unsafePath)) { // 文件不存在，判定为非法
							return false;
						}
						
					}
					return true;
				}
			},
			/**
			 * 在timeupdate时调用，从this.danmus中找出当前时间(video.currentTime)要播放的弹幕内容，加入渲染的弹幕frame.
			 * 注意timeupdate方法，1秒种只触发4次，也就是说250ms触发一次.
			 */
			addDanmu: function() {
				for (var i = 0; i < this.danmus.length; i++) {
					//if (this.danmus[i].start >= this.video.currentTime && this.danmus[i].start <= (this.video.currentTime + 0.25)) {
					var info = this.danmus[i];
					if (info.style == "Custom") {
						this.frame.addCustomSprite(info.clazz, info.param);
					} else {
						this.frame.addSprite(info);
					}
				}
			},
			/**
			 * 显示/隐藏弹幕的处理函数
			 */
			toggleDanmu: function() {
				if (this.frame.visible) { //弹幕可见
					this.frame.clearDanmu(); //情况当前所有待渲染弹幕
					this.frame.render(); //重绘一帧空的屏幕
					this.frame.stop(); //停止Frame
					this.frame.visible = false; //设置弹幕标记为不可见
				} else { //弹幕隐藏
					this.frame.begin();
					this.frame.visible = true;
				}
			},
			/**
			 * Toggle fullscreen, 注意如果浏览器支持真全屏，在全屏的时候resize窗口不会触发window的resize事件。
			 * @return false to prevent default
			 */
			fullscreen: function() {
				if (!this.isFullscreen) { //变为全屏				
					if (window.document.window.documentElement.requestFullscreen) {
						this.isTrueFullscreen = true;
						window.document.window.documentElement.requestFullscreen();
					} else if (window.document.window.documentElement.webkitRequestFullScreen) {
						this.isTrueFullscreen = true;
						window.document.window.documentElement.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
					}

					if (this.isTrueFullscreen) { //如果浏览器支持全屏
						window.console.log('True fullscreen');
						this.video.style.width = '100%';
						this.video.style.height = (screen.height - 30) + 'px';
						window.document.body.style.overflow = 'hidden';

						//更改canvas尺寸
						this.canvas.width = screen.width;
						this.canvas.height = (screen.height - 30);
					} else { //伪全屏
						window.console.log('Fake fullscreen');
						this.video.style.width = window.innerWidth + 'px';
						this.video.style.height = (window.innerHeight - 30) + 'px';
						window.document.body.style.overflow = 'hidden';

						//更改canvas尺寸
						this.canvas.width = window.innerWidth;
						this.canvas.height = window.innerHeight;
					}
					this.isFullscreen = true;

					//更改绘制弹幕的Frame的尺寸
					this.frame.resize(this.canvas.width, this.canvas.height);
				} else { //退出全屏
					if (window.document.cancelFullscreen) {
						window.document.cancelFullscreen();
					} else if (window.document.exitFullscreen) {
						window.document.exitFullscreen();
					} else if (window.document.webkitCancelFullScreen) {
						window.document.webkitCancelFullScreen();
					}

					this.video.style.height = this.videoOriginHeight + 'px';
					this.video.style.width = this.videoOriginWidth + 'px';
					window.document.body.style.overflow = 'auto';

					this.isTrueFullscreen = false;
					this.isFullscreen = false;


					//还原canvas尺寸
					this.canvas.width = this.videoOriginWidth;
					this.canvas.height = this.videoOriginHeight;
					//还原绘制弹幕的Frame的尺寸
					this.frame.resize(this.canvas.width, this.canvas.height);
					this.frame.clearDanmu(); //清空一下全屏时播放的弹幕
				}

				return false;
			},

			/**
			 * If fullscreen, auto-resize the player when the widow is resized
			 * 伪全屏状态时，浏览器窗口尺寸变化的处理函数
			 */
			updateFullscreen: function() {
				this.video.style.width = window.innerWidth + 'px';
				this.video.style.height = (window.innerHeight - 30) + 'px';

				//更改canvas尺寸
				this.canvas.width = window.innerWidth;
				this.canvas.height = window.innerHeight - 30;
				//更改绘制弹幕的Frame的尺寸
				this.frame.width = this.canvas.width;
				this.frame.height = this.canvas.height - 30;
			}

		};
	}
};