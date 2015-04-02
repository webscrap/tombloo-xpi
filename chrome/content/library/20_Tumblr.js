if(typeof(models)=='undefined')
	this.models = models = new Repository();
var Tumblr = update({}, AbstractSessionService, {
	name : 'Tumblr',
	ICON : 'http://www.tumblr.com/images/favicon.gif',
	TUMBLR_URL : 'https://www.tumblr.com/',
	SVC_URL : 'https://www.tumblr.com/svc/',
	
	/**
	 * reblog情報を取り除く。
	 *
	 * @param {Array} form reblogフォーム。
	 * @return {Deferred}
	 */
	trimReblogInfo : function(form){
		if(!getPref('model.tumblr.trimReblogInfo'))
		 return;
		 
		function trimQuote(entry){
			entry = entry.replace(/<p><\/p>/g, '').replace(/<p><a[^<]+<\/a>:<\/p>/g, '');
			entry = (function callee(all, contents){
				return contents.replace(/<blockquote>(([\n\r]|.)+)<\/blockquote>/gm, callee);
			})(null, entry);
			return entry.trim();
		}
		
		switch(form['post[type]']){
		case 'link':
			form['post[three]'] = trimQuote(form['post[three]']);
			break;
		case 'regular':
		case 'photo':
		case 'video':
			form['post[two]'] = trimQuote(form['post[two]']);
			break;
		case 'quote':
			form['post[two]'] = form['post[two]'].replace(/ \(via <a.*?<\/a>\)/g, '').trim();
			break;
		}
		
		return form;
	},
	
	/**
	 * ポスト可能かをチェックする。
	 *
	 * @param {Object} ps
	 * @return {Boolean}
	 */
	check : function(ps){
		return (/(regular|photo|quote|link|conversation|video)/).test(ps.type);
	},
    _post : function (form) {
       return request(Tumblr.TUMBLR_URL + 'svc/secure_form_key', {
          method  : 'POST',
          headers : {
            'X-tumblr-form-key' : form.form_key
          }
        }).addCallback(function (res) {
          var secure_form_key = res.channel.getResponseHeader('X-tumblr-secure-form-key');
          return request(Tumblr.TUMBLR_URL + 'svc/post/update', {
            headers     : {
			  'Content-Type'     : 'application/json',//; charset=' + charset,
			  'X-tumblr-form-key' : form.form_key,
              'X-tumblr-puppies' : secure_form_key,
			  'X-Requested-With' : 'XMLHttpRequest',
            },
			sendContent : JSON.stringify(form),
          });
        });
    },
	/**
	 * 新規エントリーをポストする。
	 *
	 * @param {Object} ps
	 * @return {Deferred}
	 */
	post : function(ps){
		var self = this;
		var endpoint = Tumblr.TUMBLR_URL + 'new/' + ps.type;
		return this.postForm(function(){
			return self.getForm(endpoint).addCallback(function(form){
				update(form, Tumblr[ps.type.capitalize()].convertToForm(ps));
				
				self.appendTags(form, ps);
				return this._post(form);
			});
		});
	},
	
	/**
	 * ポストフォームを取得する。
	 * reblogおよび新規エントリーのどちらでも利用できる。
	 *
	 * @param {Object} url フォームURL。
	 * @return {Deferred}
	 */
	getForm : function(url){
		var self = this;
	    var form = {
	        form_key: Tumblr.form_key,
	        channel_id: Tumblr.channel_id,
	        context_id: '',
	        context_page: 'dashboard',
	        custom_tweet: '',
	        'post[date]': '',
	        'post[draft_status]': '',
	        'post[publish_on]': '',
	        'post[slug]': '',
	        'is_rich_text[one]': '0',
	        'is_rich_text[three]': '0',
	        'is_rich_text[two]': '0',
	        'post[state]': '0',
	        allow_photo_replies: '',
	        send_to_fbog: '',
	        send_to_twitter:''
	    };
		return request(url).addCallback(function (res) {
			var doc = convertToHTMLDocument(res.responseText);
		    if ($x('id("logged_out_container")', doc)) {
				throw new Error(getMessage('error.notLoggedin'));
	        }
			form.form_key = Tumblr.form_key = $x('//input[@name="form_key"]/@value', doc);
	        form.channel_id = Tumblr.channel_id = $x('//input[@name="t"]/@value', doc);
		    return form;
		});
	},
	
	/**
	 * フォームへタグとプライベートを追加する。
	 *
	 * @param {Object} url フォームURL。
	 * @return {Deferred}
	 */
	appendTags : function(form, ps){
		if(ps.private!=null)
			form['post[state]'] = (ps.private)? 'private' : 0;
		
		if (ps.type !== 'regular' && getPref('model.tumblr.queue')) {
			form['post[state]'] = 2;
		}
		
		if (getPref('model.tumblr.appendContentSource')) {
			if (!ps.favorite || !ps.favorite.name || ps.favorite.name !== 'Tumblr') {
				// not reblog post
				if (ps.pageUrl && ps.pageUrl !== 'http://') {
					form['post[source_url]'] = ps.pageUrl;
					if (ps.type !== 'link') {
						form['post[three]'] = ps.pageUrl;
					}
				}
			}
		}
		
		return update(form, {
			'post[tags]' : (ps.tags && ps.tags.length)? joinText(ps.tags, ',') : '',
		});
	},
	
	/**
	 * reblogする。
	 * Extractors.ReBlogの各抽出メソッドを使いreblog情報を抽出できる。
	 *
	 * @param {Object} ps
	 * @return {Deferred}
	 */
	favor : function(ps){
		// メモをreblogフォームの適切なフィールドの末尾に追加する
		var form = ps.favorite.form;
		items(Tumblr[ps.type.capitalize()].convertToForm({
			description : ps.description,
		})).forEach(function([name, value]){
			if(!value)
				return;
			
			form[name] += '\n\n' + value;
		});
		
		this.appendTags(form, ps);
		
		return this.postForm(function(){
			return request(ps.favorite.endpoint, {sendContent : form})
		});
	},
	
	/**
	 * フォームをポストする。
	 * 新規エントリーとreblogのエラー処理をまとめる。
	 *
	 * @param {Function} fn
	 * @return {Deferred}
	 */
	postForm : function(fn){
		var self = this;
		var d = succeed();
		d.addCallback(fn);
		d.addCallback(function(res){
			var url = res.channel.URI.asciiSpec;
			switch(true){
			case /dashboard/.test(url):
				return;
			
			case /login/.test(url):
				throw new Error(getMessage('error.notLoggedin'));
			
			default:
				// このチェックをするためリダイレクトを追う必要がある
				// You've used 100% of your daily photo uploads. You can upload more tomorrow.
				if(!res.responseText) {
					return;
				}
				if(res.responseText.match('more tomorrow'))
					throw new Error("You've exceeded your daily post limit.");
				
				var doc = convertToHTMLDocument(res.responseText);
				var err = convertToPlainText(doc.getElementById('errors') || doc.querySelector('.errors'));
				if(err) {
					throw new Error(err);
				}
				else {
					return;
				}
			}
		});
		return d;
	},
	
	getPasswords : function(){
		return getPasswords('https://www.tumblr.com');
	},
	
	login : function(user, password){
		var LOGIN_FORM_URL = 'https://www.tumblr.com/login';
		var self = this;
		notify(self.name, getMessage('message.changeAccount.logout'), self.ICON);
		return Tumblr.logout().addCallback(function(){
			return request(LOGIN_FORM_URL).addCallback(function(res){
				notify(self.name, getMessage('message.changeAccount.login'), self.ICON);
				var doc = convertToHTMLDocument(res.responseText);
				var form = doc.getElementById('signup_form');
				return request(LOGIN_FORM_URL, {
					sendContent : update(formContents(form), {
						'user[email]'    : user,
						'user[password]' : password
					})
				});
			}).addCallback(function(){
				self.updateSession();
				self.user = user;
				notify(self.name, getMessage('message.changeAccount.done'), self.ICON);
			});
		});
	},
	
	logout : function(){
		return request(Tumblr.TUMBLR_URL+'logout');
	},
	
	getAuthCookie : function(){
		return getCookieString('www.tumblr.com');
	},
	
	/**
	 * ログイン中のユーザーを取得する。
	 * 結果はキャッシュされ、再ログインまで再取得は行われない。
	 * アカウント切り替えのためのインターフェースメソッド。
	 *
	 * @return {Deferred} ログインに使われるメールアドレスが返される。
	 */
	getCurrentUser : function(){
		switch (this.updateSession()){
		case 'none':
			return succeed('');
			
		case 'same':
			if(this.user)
				return succeed(this.user);
			
		case 'changed':
			var self = this;
			return request(Tumblr.TUMBLR_URL+'preferences').addCallback(function(res){
				var doc = convertToHTMLDocument(res.responseText);
				return self.user = $x('id("user_email")/@value', doc);
			});
		}
	},
	
	getTumblelogs : function(){
		return request(Tumblr.TUMBLR_URL+'new/text').addCallback(function(res){
			var doc = convertToHTMLDocument(res.responseText);
			return $x('id("channel_id")//option[@value!=0]', doc, true).map(function(opt){
				return {
					id : opt.value,
					name : opt.textContent,
				}
			});
		});
	},

	getReblogPostInfo : function(reblogID, reblogKey, postType) {
		return request(this.SVC_URL + 'post/fetch', {
			responseType : 'json',
			queryString  : {
				reblog_id  : reblogID,
				reblog_key : reblogKey,
				post_type  : postType || ''
			}
		}).addCallback(({response : json}) => {
			if (json.errors === false) {
				let {post} = json;

				if (post) {
					return post;
				}
			}

			throw new Error(json.error || getMessage('error.contentsNotFound'));
		});
	}
});


Tumblr.Regular = {
	convertToForm : function(ps){
		return {
			'post[type]' : ps.type,
			'post[one]'  : ps.item,
			'post[two]'  : joinText([getFlavor(ps.body, 'html'), ps.description], '\n\n'),
		};
	},
}

Tumblr.Photo = {
	convertToForm : function(ps){
		var form = {
			'post[type]'  : ps.type,
			'post[two]'   : joinText([ps.item || '',ps.description], '\n\n'),
			'post[three]' : ps.pageUrl,
			'editor_type' : 'rich',
			MAX_FILE_SIZE: '10485760',
		};
		if(ps.file) {
			form['photo[]'] = ps.file;
		}
		else {
			form['photo_src[]'] = ps.itemUrl;
            form['images[o1]'] = form['photo_src[]'];
            form['post[photoset_layout]'] = '1';
            form['post[photoset_order]'] = 'o1';
		}
		
		return form;
	},
}

Tumblr.Video = {
	convertToForm : function(ps){
		return {
			'post[type]' : ps.type,
			'post[one]'  : getFlavor(ps.body, 'html') || ps.itemUrl,
			'post[two]'  : joinText([
				(ps.item? ps.item.link(ps.pageUrl) : '') + (ps.author? ' (via ' + ps.author.link(ps.authorUrl) + ')' : ''), 
				ps.description], '\n\n'),
		};
	},
}

Tumblr.Link = {
	convertToForm : function(ps){
		var thumb = getPref('thumbnailTemplate').replace(RegExp('{url}', 'g'), ps.pageUrl);
		return {
			'post[type]'  : ps.type,
			'post[one]'   : ps.item,
			'post[two]'   : ps.itemUrl,
			'post[three]' : joinText([thumb, getFlavor(ps.body, 'html'), ps.description], '\n\n'),
		};
	},
}

Tumblr.Conversation = {
	convertToForm : function(ps){
		return {
			'post[type]' : ps.type,
			'post[one]'  : ps.item,
			'post[two]'  : joinText([getFlavor(ps.body, 'html'), ps.description], '\n\n'),
		};
	},
}

Tumblr.Quote = {
	convertToForm : function(ps){
		return {
			'post[type]' : ps.type,
			'post[one]'  : getFlavor(ps.body, 'html'),
			'post[two]'  : joinText([(ps.item? ps.item.link(ps.pageUrl) : ''), ps.description], '\n\n'),
		};
	},
}

models.register(Tumblr);


/*
 * Tumblrフォーム変更対応パッチ(2013/1/25周辺)
 * UAを古いAndroidにして旧フォームを取得。
 *
 * polygonplanetのコードを簡略化(パフォーマンス悪化の懸念あり)
 * https://gist.github.com/polygonplanet/4643063
 *
 * 2013年5月末頃の変更に対応する為、UAをIE8に変更
 *
 * 2015年1月29日の変更に対応する為、UAをFirefox for Android(Mobile)に変更
*/
/*
var request_ = request;
request = function(url, opts){
	if(/^https?:\/\/(?:\w+\.)*tumblr\..*\/(?:reblog\/|new\/\w+)/.test(url)){
		if (!(opts && opts.responseType)) {
			opts = updatetree(opts, {
				responseType : 'text'
			});
		}
		opts = updatetree(opts, {
			headers : {
				'User-Agent' : 'Mozilla/5.0 (Android; Mobile; rv:35.0) Gecko/35.0 Firefox/35.0'
			}
		});
		if (getCookieValue('www.tumblr.com', 'disable_mobile_layout') === '1') {
			// via https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsICookieManager#remove()
			CookieManager.remove('www.tumblr.com', 'disable_mobile_layout', '/', false);
		}
	}
	
	return request_(url, opts);
};
*/
