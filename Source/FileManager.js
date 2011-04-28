/*
---

description: FileManager

authors: Christoph Pojer (@cpojer), Fabian Vogelsteller (@frozeman)

license: MIT-style license

requires:
  core/1.3.1: '*'
  more/1.3.1.1: [Array.Extras, String.QueryString, Hash, Element.Delegation, Element.Measure, Fx.Scroll, Fx.SmoothScroll, Drag, Drag.Move, Assets, Tips ]

provides: Filemanager

...
*/

var FileManager = new Class({

	Implements: [Options, Events],

	Request: null,
	RequestQueue: null,
	Directory: null,
	Current: null,
	ID: null,

	options: {
		/*
		 * onComplete: function(           // Fired when the 'Select' button is clicked
		 *                      path,      // URLencoded absolute URL path to selected file
		 *                      file,      // the file specs object: .dir, .name, .path, .size, .date, .mime, .icon, .icon48, .thumb48, .thumb250
		 *                      fmobj      // reference to the FileManager instance which fired the event
		 *                     ){},
		 *
		 * onModify: function(             // Fired when either the 'Rename' or 'Delete' icons are clicked or when a file is drag&dropped.
		 *                                 // Fired AFTER the action is executed.
		 *                    file,        // a CLONE of the file specs object: .dir, .name, .path, .size, .date, .mime, .icon, .icon48, .thumb48, .thumb250
		 *                    json,        // The JSON data as sent by the server for this 'destroy/rename/move/copy' request
		 *                    mode,        // string specifying the action: 'destroy', 'rename', 'move', 'copy'
		 *                    fmobj        // reference to the FileManager instance which fired the event
		 *                   )
		 *
		 * onShow: function(               // Fired AFTER the file manager is rendered
		 *                  fmobj          // reference to the FileManager instance which fired the event
		 *                 )
		 *
		 * onHide: function(               // Fired AFTER the file manager is removed from the DOM
		 *                  fmobj          // reference to the FileManager instance which fired the event
		 *                 )
		 *
		 * onScroll: function(             // Cascade of the window scroll event
		 *                    e,           // reference to the event object (argument passed from the window.scroll event)
		 *                    fmobj        // reference to the FileManager instance which fired the event
		 *                   )
		 *
		 * onPreview: function(            // Fired when the preview thumbnail image is clicked
		 *                     src,        // this.get('src') ???
		 *                     fmobj,      // reference to the FileManager instance which fired the event
		 *                     el          // reference to the 'this' ~ the element which was clicked
		 *                    )
		 *
		 * onDetails: function(            // Fired when an item is picked from the files list to be previewed
		 *                                 // Fired AFTER the server request is completed and BEFORE the preview is rendered.
		 *                     json,       // The JSON data as sent by the server for this 'detail' request
		 *                     fmobj       // reference to the FileManager instance which fired the event
		 *                    )
		 *
		 * onHidePreview: function(        // Fired when the preview is hidden (e.g. when uploading)
		 *                                 // Fired BEFORE the preview is removed from the DOM.
		 *                         fmobj   // reference to the FileManager instance which fired the event
		 *                        )
		 */
		directory: '',
		url: null,
		assetBasePath: null,
		language: 'en',
		selectable: false,
		destroy: false,
		rename: false,
		move_or_copy: false,
		download: false,
		createFolders: false,
		filter: '',
		hideOnClick: false,
		hideClose: false,
		hideOverlay: false,
		hideQonDelete: false,
		verbose: false,
		zIndex: 1000,
		styles: {},
		listPaginationSize: 100,          // add pagination per N items for huge directories (speed up interaction)
		listPaginationAvgWaitTime: 2000,  // adaptive pagination: strive to, on average, not spend more than this on rendering a directory chunk
		propagateData: {},                 // extra query parameters sent with every request to the backend

		standalone: true,					// (boolean). Default to true. If set to false, returns the Filemanager without enclosing window / overlay.
		parentContainer: null,				// (string). ID of the parent container. If not set, FM will consider its first container parent for fitSizes();
		hideOnSelect: true					// (boolean). Default to true. If set to false, it leavers the FM open after a picture select.
	},

	/*
	 * hook items are objects (kinda associative arrays, as they are used here), where each
	 * key item is called when the hook is invoked.
	 */
	hooks: {
		show: {},                         // invoked after the 'show' event
		cleanup: {},                      // invoked before the 'hide' event
		cleanupPreview: {}                // invoked before the 'hidePreview' event
	},

	initialize: function(options) {
		this.setOptions(options);
		this.diag.verbose = this.options.verbose;
		this.ID = String.uniqueID();
		this.droppables = [];
		this.assetBasePath = this.options.assetBasePath.replace(/(\/|\\)*$/, '/');
		this.Directory = this.options.directory;
		this.root = null;
		this.CurrentDir = null;
		this.listType = 'list';
		this.dialogOpen = false;
		this.usingHistory = false;
		this.fmShown = false;
		this.drop_pending = 0;           // state: 0: no drop pending, 1: copy pending, 2: move pending
		this.view_fill_timer = null;     // timer reference when fill() is working chunk-by-chunk.
		this.view_fill_startindex = 0;   // offset into the view JSON array: which part of the entire view are we currently watching?
		this.view_fill_json = null;      // the latest JSON array describing the entire list; used with pagination to hop through huge dirs without repeatedly consulting the server.
		this.listPaginationLastSize = this.options.listPaginationSize;
		this.Request = null;
		this.downloadIframe = null;
		this.downloadForm = null;
		this.drag_is_active = false;
		this.ctrl_key_pressed = false;
		this.pending_error_dialog = null;
		// timer for dir-gallery click / dblclick events:
		this.dir_gallery_click_timer = null;


		this.RequestQueue = new Request.Queue({
			concurrent: 3,				// 3 --> 75% max load on a quad core server
			autoAdvance: true,
			stopOnFailure: false
		});

		this.language = Object.clone(FileManager.Language.en);
		if (this.options.language !== 'en') {
			this.language = Object.merge(this.language, FileManager.Language[this.options.language]);
		}

// Partikule
		if (!this.options.standalone)
		{
			this.options.hideOverlay = true;
			this.options.hideClose = true;
		}
// /Partikule

		this.container = new Element('div', {
			'class': 'filemanager-container' + (Browser.opera ? ' filemanager-engine-presto' : '') + (Browser.ie ? ' filemanager-engine-trident' : '') + (Browser.ie8 ? '4' : '') + (Browser.ie9 ? '5' : ''),
			styles:
			{
				'z-index': this.options.zIndex
			}
		});
		this.filemanager = new Element('div', {
			'class': 'filemanager',
			styles: Object.append({},
			this.options.styles,
			{
				'z-index': this.options.zIndex + 1
			})
		}).inject(this.container);
		this.header = new Element('div', {
			'class': 'filemanager-header' /* ,
			styles:
			{
				'z-index': this.options.zIndex + 3
			} */
		}).inject(this.filemanager);
		this.menu = new Element('div', {
			'class': 'filemanager-menu' /* ,
			styles:
			{
				'z-index': this.options.zIndex + 2
			} */
		}).inject(this.filemanager);
		this.loader = new Element('div', {'class': 'loader', opacity: 0, tween: {duration: 'short'}}).inject(this.header);
		this.previewLoader = new Element('div', {'class': 'loader', opacity: 0, tween: {duration: 'short'}});
		this.browserLoader = new Element('div', {'class': 'loader', opacity: 0, tween: {duration: 'short'}});
		// switch the path, from clickable to input text
		this.clickablePath = new Element('span', {'class': 'filemanager-dir'});
		this.selectablePath = new Element('input',{'type': 'text', 'class': 'filemanager-dir', 'readonly': 'readonly'});
		this.pathTitle = new Element('a', {href:'#','class': 'filemanager-dir-title',text: this.language.dir}).addEvent('click',(function(e){
			this.diag.log('pathTitle-click event: ' + e.target + ': ' + e.type + ' @ ' + e.target.outerHTML);
			e.stop();
			if (this.header.getElement('span.filemanager-dir') != null) {
				this.selectablePath.setStyle('width',(this.header.getSize().x - this.pathTitle.getSize().x - 55));
				this.selectablePath.replaces(this.clickablePath);
			}
			else {
				this.clickablePath.replaces(this.selectablePath);
			}
		}).bind(this));
		this.header.adopt(this.pathTitle,this.clickablePath);

// Partikule
// Because the header is positioned -30px before the container, we hide it for the moment if the FM isn't standalone.
// Need to think about a better integration
		if (!this.options.standalone)
		{
			this.header.hide();
			this.filemanager.setStyle('width', '100%');
		}
// /Partikule

		var self = this;

		this.browsercontainer = new Element('div',{'class': 'filemanager-browsercontainer'}).inject(this.filemanager);
		this.browserheader = new Element('div',{'class': 'filemanager-browserheader'}).inject(this.browsercontainer);
		this.browserheader.adopt(this.browserLoader);
		this.browserScroll = new Element('div', {'class': 'filemanager-browserscroll'}).inject(this.browsercontainer).addEvents({
			'mouseover': (function(e){
					//this.diag.log('mouseover: ', e);

					// sync mouse and keyboard-driven browsing: the keyboard requires that we keep track of the hovered item,
					// so we cannot simply leave it to a :hover CSS style. Instead, we find out which element is currently
					// hovered:
					var row = null;
					if (e.target)
					{
						row = (e.target.hasClass('fi') ? e.target : e.target.getParent('span.fi'));
						if (row)
						{
							row.addClass('hover');
						}
					}
					this.browser.getElements('span.fi.hover').each(function(span){
						// prevent screen flicker: only remove the class for /other/ nodes:
						if (span != row) {
							span.removeClass('hover');
							var rowicons = span.getElements('img.browser-icon');
							if (rowicons)
							{
								rowicons.each(function(icon) {
									icon.set('tween', {duration: 'short'}).fade(0);
								});
							}
						}
					});

					if  (row)
					{
						var icons = row.getElements('img.browser-icon');
						if (icons)
						{
							icons.each(function(icon) {
								if (e.target == icon)
								{
									icon.set('tween', {duration: 'short'}).fade(1);
								}
								else
								{
									icon.set('tween', {duration: 'short'}).fade(0.5);
								}
							});
						}
					}
				}).bind(this),

			/* 'mouseout' */
			'mouseleave': (function(e){
					//this.diag.log('mouseout: ', e);

					// only bother us when the mouse cursor has just left the browser area; anything inside there is handled
					// by the recurring 'mouseover' event above...
					//
					// - do NOT remove the 'hover' marker from the row; it will be used by the keyboard!
					// - DO fade out the action icons, though!
					this.browser.getElements('span.fi.hover').each(function(span){
						var rowicons = span.getElements('img.browser-icon');
						if (rowicons)
						{
							rowicons.each(function(icon) {
								icon.set('tween', {duration: 'short'}).fade(0);
							});
						}
					});

				}).bind(this)
			});
		this.browserMenu_thumb = new Element('a',{
				'id':'toggle_side_boxes',
				'class':'listType',
				'style' : 'margin-right: 10px;',
				'title': this.language.toggle_side_boxes
			}).set('opacity',0.5).addEvents({
				click: this.toggleList.bind(this)
			});
		this.browserMenu_list = new Element('a',{
				'id':'toggle_side_list',
				'class':'listType',
				'title': this.language.toggle_side_list
			}).set('opacity',1).addEvents({
				click: this.toggleList.bind(this)
			});

// Partikule : Thumbs list in preview panel
	    this.browserMenu_thumbList = new Element('a',{
				'id': 'show_dir_thumb_gallery',
				'title': this.language.show_dir_thumb_gallery
			}).addEvent('click', function()
			{
				// do NOT change the jsGET history carrying our browsing so far; the fact we want to view the dirtree should
				// *NOT* blow away the recall in which directory we are (and what item is currently selected):

				//if (typeof jsGET !== 'undefined')
				//	jsGET.clear();

				// no need to request the dirscan again: after all, we only wish to render another view of the same directory.
				// (This means, however, that we MAY requesting any deferred thumbnails)

				//self.load(self.Directory, true);
				//return self.deselect();   // nothing to return on a click event, anyway. And do NOT loose the selection!

				// the code you need here is identical to clicking on the current directory in the top path bar:

				// show the 'directory' info in the detail pane again (this is a way to get back from previewing single files to previewing the directory as a gallery)
				this.diag.log('click: fillInfo: current directory!');
				this.fillInfo();
			}.bind(this));
// /Partikule


		this.browser_dragndrop_info = new Element('a',{
				'id':'drag_n_drop',
				'title': this.language.drag_n_drop_disabled
			}); // .setStyle('visibility', 'hidden');
		this.browser_paging = new Element('div',{
				'id':'fm_view_paging'
			}).set('opacity', 0); // .setStyle('visibility', 'hidden');
		this.browser_paging_first = new Element('a',{
				'id':'paging_goto_first'
			}).set('opacity', 1).addEvents({
				click: this.paging_goto_first.bind(this)
			});
		this.browser_paging_prev = new Element('a',{
				'id':'paging_goto_previous'
			}).set('opacity', 1).addEvents({
				click: this.paging_goto_prev.bind(this)
			});
		this.browser_paging_next = new Element('a',{
				'id':'paging_goto_next'
			}).set('opacity', 1).addEvents({
				click: this.paging_goto_next.bind(this)
			});
		this.browser_paging_last = new Element('a',{
				'id':'paging_goto_last'
			}).set('opacity', 1).addEvents({
				click: this.paging_goto_last.bind(this)
			});
		this.browser_paging_info = new Element('span',{
				'id':'paging_info',
				'text': ''
			});
		this.browser_paging.adopt([this.browser_paging_first, this.browser_paging_prev, this.browser_paging_info, this.browser_paging_next, this.browser_paging_last]);

// Partikule : Added the browserMenu_thumbList to the browserheader
		this.browserheader.adopt([this.browserMenu_thumbList, this.browserMenu_thumb, this.browserMenu_list, this.browser_dragndrop_info, this.browser_paging]);
// /Partikule

		this.browser = new Element('ul', {'class': 'filemanager-browser'}).inject(this.browserScroll);

		if (this.options.createFolders) this.addMenuButton('create');
		if (this.options.download) this.addMenuButton('download');
		if (this.options.selectable) this.addMenuButton('open');

		this.info = new Element('div', {'class': 'filemanager-infos'});

		this.info_head = new Element('div', {
			'class': 'filemanager-head',
			styles:
			{
				opacity: 0
			}
		}).adopt([
			new Element('img', {'class': 'filemanager-icon'}),
			new Element('h1')
		]);

		this.preview = new Element('div', {'class': 'filemanager-preview'}).addEvent('click:relay(img.preview)', function(){
			self.fireEvent('preview', [this.get('src'), self, this]);
		});

		// We need to group the headers and lists together because we may
		// use some CSS to reorganise it a bit in the custom event handler.  So we create "filemanager-preview-area" which
		// will contain the h2 for the preview and also the preview content returned from
		// Backend/FileManager.php
		this.preview_area = new Element('div', {'class': 'filemanager-preview-area',
			styles:
			{
				opacity: 0
			}
		});

// Partikule. Removed new Element('h2', {'class': 'filemanager-headline' :
// 1. To gain more vertical space for preview
// 2. Because the user knows this is info about the file
		this.preview_area.adopt([
			//new Element('h2', {'class': 'filemanager-headline', text: this.language.more}),
			this.preview
		]);

// Partikule.
// 1. To gain more vertical space for preview
// 2. Because the user knows this is info about the file
// 3. Less is more :-)
		this.info.adopt([this.info_head, this.preview_area]).inject(this.filemanager);
// /Partikule

// Partikule
// Add of the thumbnail list in the preview panel

// We fill this one while we render the directory tree view to ensure that the deferred thumbnail loading system
// (using 'detail / mode=direct' requests to obtain the actual thumbnail paths) doesn't become a seriously complex
// mess.
// This way, any updates coming from the server are automatically edited into this list; whether it is shown or
// not depends on the decisions in fillInfo()
//
// Usage:
// - One doubleclick on one thumb in this list will select the file : quicker select
// - One click displays the preview, but with the file in bigger format : less clicks to see the picture wider.

		// Thumbs list container (in preview panel)
		this.dir_filelist = new Element('div', {'class': 'filemanager-filelist'});
		//this.preview.adopt(this.dir_filelist);

// /Partikule

		if (!this.options.hideClose) {
			this.closeIcon = new Element('a', {
				'class': 'filemanager-close',
				opacity: 0.5,
				title: this.language.close,
				events: {click: this.hide.bind(this)}
			}).inject(this.filemanager).addEvent('mouseover',function(){
					this.fade(1);
				}).addEvent('mouseout',function(){
					this.fade(0.5);
				});
		}

		this.tips = new Tips({
			className: 'tip-filebrowser',
			offsets: {x: 15, y: 0},
			text: null,
			showDelay: 50,
			hideDelay: 50,
			onShow: function(){
				this.tip.setStyle('z-index', self.options.zIndex + 501).set('tween', {duration: 'short'}).setStyle('display', 'block').fade(1);
			},
			onHide: function(){
				this.tip.fade(0).get('tween').chain(function(){
					this.element.setStyle('display', 'none');
				});
			}
		});
		if (!this.options.hideClose) {
			this.tips.attach(this.closeIcon);
		}

		this.imageadd = new Asset.image(this.assetBasePath + 'Images/add.png', {
			'class': 'browser-add',
			styles:
			{
				'z-index': this.options.zIndex + 1600
			}
		}).set('opacity', 0).set('tween', {duration: 'short'}).inject(this.container);

// Partikule : Moved a little bit more on the bottom...
//		this.container.inject(document.body);
// /Partikule

		if (!this.options.hideOverlay) {
			this.overlay = new Overlay(Object.append((this.options.hideOnClick ? {
				events: {
					click: this.hide.bind(this)
				}
			} : {}),
			{
				styles:
				{
					'z-index': this.options.zIndex - 1
				}
			}));
		}

		this.bound = {
			keydown: (function(e)
			{
				// at least FF on Win will trigger this function multiple times when keys are depressed for a long time. Hence time consuming actions are don in 'keyup' whenever possible.

				this.diag.log('keydown: key press: ', e);
				if (e.control || e.meta)
				{
					if (this.drag_is_active && !this.ctrl_key_pressed)
					{
						// only init the fade when actually switching CONTROL key states!
						this.imageadd.fade(1);
					}
					this.ctrl_key_pressed = true;
				}
			}).bind(this),
			keyup: (function(e)
			{
				this.diag.log('keyup: key press: ' + e.key + ', ctrl: ' + e.control);
				if (!e.control && !e.meta)
				{
					if (/* this.drag_is_active && */ this.ctrl_key_pressed)
					{
						// only init the fade when actually switching CONTROL key states!
						this.imageadd.fade(0);
					}
					this.ctrl_key_pressed = false;
				}

				if (!this.dialogOpen)
				{
					switch (e.key)
					{
					case 'tab':
						e.preventDefault();
						this.toggleList();
						break;

					case 'esc':
						this.hide();
						break;
					}
				}
			}).bind(this),
			keyboardInput: (function(e)
			{
				this.diag.log('keyboardInput key press: ' + e.key);
				if (this.dialogOpen) return;
				switch (e.key)
				{
				case 'up':
				case 'down':
				case 'pageup':
				case 'pagedown':
				case 'home':
				case 'end':
				case 'enter':
				case 'delete':
					e.preventDefault();
					this.browserSelection(e.key);
					break;
				}
			}).bind(this),
			scroll: (function(e)
			{
				this.fireEvent('scroll', [e, this]);
				this.fitSizes();
			}).bind(this)
		};

// Partikule
		if (this.options.standalone)
		{
	    	this.container.inject(document.body);

			// ->> autostart filemanager when set
			this.initialShow();
	    }
	    else
	    {
// Partikule : Removed the autostart bacause of the standalone mode.
// Certainly a better way to do that...
	    	this.options.hideOverlay = true;
	    }
    	return this;
	},

	initialShowBase: function() {
		if (typeof jsGET !== 'undefined' && jsGET.get('fmID') == this.ID) {
			this.show();
		}
		else {
			window.addEvent('jsGETloaded',(function(){
				if (typeof jsGET !== 'undefined' && jsGET.get('fmID') == this.ID)
					this.show();
			}).bind(this));
		}
	},

	// overridable method:
	initialShow: function() {
		this.initialShowBase();
	},

	allow_DnD: function(j, pagesize)
	{
		if (!this.options.move_or_copy)
			return false;

		if (!j || !j.dirs || !j.files || !pagesize)
			return true;

		return (j.dirs.length + j.files.length <= pagesize * 4);
	},

	fitSizes: function()
	{
// Partikule : Add the standalone check
		if (this.options.standalone)
		{
			this.filemanager.center(this.offsets);
		}
		else
		{
			var parent = (this.options.parentContainer != null ? $(this.options.parentContainer) : this.container.getParent());
			if (parent)
			{
				parentSize = parent.getSize();
				this.filemanager.setStyle('height', parentSize.y);
			}
		}
// /Partikule

		var containerSize = this.filemanager.getSize();
		var headerSize = this.browserheader.getSize();
		var menuSize = this.menu.getSize();
		this.browserScroll.setStyle('height',containerSize.y - headerSize.y);
		this.info.setStyle('height',containerSize.y - menuSize.y);
	},

	// see also: http://cass-hacks.com/articles/discussion/js_url_encode_decode/
	// and: http://xkr.us/articles/javascript/encode-compare/
	// This is a much simplified version as we do not need exact PHP rawurlencode equivalence.
	//
	// We have one mistake to fix: + instead of %2B. We don't mind
	// that * and / remain unencoded. Not exactly RFC3986, but there you have it...
	//
	// WARNING: given the above, we ASSUME this function will ONLY be used to encode the
	//          a single URI 'path', 'query' or 'fragment' component at a time!
	escapeRFC3986: function(s) {
		return encodeURI(s.toString()).replace(/\+/g, '%2B').replace(/#/g, '%23');
	},
	unescapeRFC3986: function(s) {
		return decodeURI(s.toString());
	},

	// -> catch a click on an element in the file/folder browser
	relayClick: function(e, el) {
		if (e) e.stop();

		// ignore mouse clicks while drag&drop + resulting copy/move is pending.
		//
		// Theoretically only the first click originates from the same mouse event as the 'drop' event, so we
		// COULD reset 'drop_pending' after processing that one.
		if (this.drop_pending != 0)
		{
			this.drop_pending = 0;
		}
		else
		{
			this.storeHistory = true;

			var file = el.retrieve('file');
			this.diag.log('on relayClick file = ', file, this.Directory);
			if (el.retrieve('edit')) {
				el.eliminate('edit');
				return;
			}
			if (file.mime === 'text/directory') {
				el.addClass('selected');
				// reset the paging to page #0 as we clicked to change directory
				this.store_view_fill_startindex(0);
				this.load(this.Directory + file.name);
				return;
			}

			// when we're right smack in the middle of a drag&drop, which may end up as a MOVE, do NOT send a 'detail' request
			// alongside (through fillInfo) as that may lock the file being moved, server-side.
			// It's good enough to disable the detail view, if we want/need to.
			//
			// Note that this.drop_pending tracks the state of the drag&drop state machine -- more functions may check this one!
			if (this.Current) {
				this.Current.removeClass('selected');
			}
			// ONLY do this when we're doing a COPY or on a failed attempt...
			// CORRECTION: as even a failed 'drop' action will have moved the cursor, we can't keep this one selected right now:
			this.Current = el.addClass('selected');
			// We need to have Current assigned before fillInfo because fillInfo adds to it
			this.fillInfo(file);

			this.switchButton4Current();
		}
	},

// Partikule

	/**
	 * Catches both single and double click on thumb list icon in the directory preview thumb/gallery list
	 */
	relayDblClick: function(e, self, dg_el, file, clicks)
	{
		if (e) e.stop();

		this.diag.log('on relayDblClick file = ', file, this.Directory, ', # clicks: ', clicks);

		this.tips.hide();

		//var file = el.retrieve('file'); -- wrong 'el': that 'el' is a <LI> in the directory view!
		var el_ref = dg_el.retrieve('el_ref');

		if (this.Current)
		{
			this.Current.removeClass('selected');
		}

		this.Current = el_ref.addClass('selected');
		file = el_ref.retrieve('file');

		this.CurrentFile = file;

		// now make sure we can see the selected item in the left pane: scroll there:
		this.browserSelection('none');

		// only simulate the 'select' button click by doubleclick on thumbnail in directory preview, when 'select' is actually allowed.
		if (clicks === 2 && this.options.selectable)
		{
			this.open_on_click(null);
		}
		else
		{
			// the single-click action is to simulate a click on the corresponding line in the directory view (left pane)
			this.relayClick(e, el_ref);
		}
	},

// /Partikule

	toggleList: function(e) {
		if (e) e.stop();

		$$('.filemanager-browserheader a.listType').set('opacity',0.5);
		if (!this.browserMenu_thumb.retrieve('set',false)) {
			this.browserMenu_list.store('set',false);
			this.browserMenu_thumb.store('set',true).set('opacity',1);
			this.listType = 'thumb';
			if (typeof jsGET !== 'undefined') jsGET.set('fmListType=thumb');
		} else {
			this.browserMenu_thumb.store('set',false);
			this.browserMenu_list.store('set',true).set('opacity',1);
			this.listType = 'list';
			if (typeof jsGET !== 'undefined') jsGET.set('fmListType=list');
		}
		this.diag.log('on toggleList dir = ', this.Directory, e);
		//this.load(this.Directory);

		// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
		//this.reset_view_fill_store();
		clearTimeout(this.view_fill_timer);
		this.view_fill_timer = null;

		this.fill(null, this.get_view_fill_startindex(), this.listPaginationLastSize);
	},

	/*
	 * Gets called from the jsGET listener.
	 *
	 * Is fired for two reasons:
	 *
	 * 1) the user clicked on a file or directory to view and that change was also pushed to the history through one or more jsGET.set() calls.
	 *    (In this case, we've already done what needed doing, so we should not redo that effort in here!)
	 *
	 * 2) the user went back in browser history or manually edited the URI hash section.
	 *    (This is an 'change from the outside' and exactly what this listener is for. This time around, we should follow up on those changes!)
	 */
	hashHistory: function(vars)
	{
		this.storeHistory = false;
		this.diag.log(vars);
		if (vars.changed['fmPath'] === '')
			vars.changed['fmPath'] = '/';

		Object.each(vars.changed, function(value, key) {
			this.diag.log('on hashHistory key = ', key, 'value = ', value);
			switch (key)
			{
			case 'fmPath':
				if (this.Directory !== value)
				{
					this.load(value);
				}
				break;

			case 'fmFile':
				var hot_item = (this.Current && this.Current.retrieve('file'));
				if (hot_item == null || value !== hot_item.name)
				{
					this.browser.getElements('span.fi span').each((function(current)
					{
						current.getParent('span.fi').removeClass('hover');
						if (current.get('title') == value)
						{
							this.deselect();
							this.Current = current.getParent('span.fi');
							new Fx.Scroll(this.browserScroll,{duration: 'short', offset: {x: 0, y: -(this.browserScroll.getSize().y/4)}}).toElement(this.Current);
							this.Current.addClass('selected');
							this.diag.log('on hashHistory @ fillInfo key = ', key, 'value = ', value, 'source = ', current, 'file = ', current.getParent('span.fi').retrieve('file'));
							this.fillInfo(this.Current.retrieve('file'));
						}
					}).bind(this));
				}
				break;
			}
		},this);
	},

	// Add the ability to specify a path (relative to the base directory) and a file to preselect
	show: function(e, loaddir, preselect) {
		if (e) e.stop();
		this.diag.log('on show');
		if (this.fmShown) {
			return;
		}
		this.fmShown = true;
		this.onShow = false;

		if (typeof preselect === 'undefined') preselect = null;

		this.diag.log('on show file = ', this.Directory);
		if (typeof loaddir !== 'undefined' && loaddir != null)
		{
			this.Directory = loaddir;
		}
		else if (typeof jsGET !== 'undefined')
		{
			if (jsGET.get('fmPath') != null)
			{
				this.Directory = jsGET.get('fmPath');
			}
		}
		if (preselect)
		{
			this.onShow = true;
		}

		// get and set history
		if (typeof jsGET !== 'undefined') {
			if (jsGET.get('fmFile') != null) this.onShow = true;
			if (jsGET.get('fmListType') != null) {
				$$('.filemanager-browserheader a.listType').set('opacity',0.5);
				this.listType = jsGET.get('fmListType');
				if (this.listType === 'thumb')
					this.browserMenu_thumb.store('set',true).set('opacity',1);
				else
					this.browserMenu_list.store('set',true).set('opacity',1);
			}
			jsGET.set({'fmID': this.ID, 'fmPath': this.Directory});
			this.hashListenerId = jsGET.addListener(this.hashHistory, false, this);
		}

		this.load(this.Directory, preselect);
		if (!this.options.hideOverlay) {
			this.overlay.show();
		}

		this.show_our_info_sections(false);
		this.container.fade(0).setStyles({
				display: 'block'
			});

		window.addEvents({
			'scroll': this.bound.scroll,
			'resize': this.bound.scroll
		});
		// add keyboard navigation
		this.diag.log('add keyboard nav on show file = ' + this.Directory + ', source = ' + '---');
		document.addEvent('keydown', this.bound.keydown);
		document.addEvent('keyup', this.bound.keyup);
		if ((Browser.Engine && (Browser.Engine.trident || Browser.Engine.webkit)) || (Browser.ie || Browser.chrome || Browser.safari))
			document.addEvent('keydown', this.bound.keyboardInput);
		else
			document.addEvent('keypress', this.bound.keyboardInput);
		this.container.fade(1);

		this.fitSizes();
		this.fireEvent('show', [this]);
		this.fireHooks('show');

// Partikule : If not standalone, returns the HTML content
	   	if (!this.options.standalone)
		{
	    	return this.container;
	    }
// /Partikule
	},

	hide: function(e){
		if (e) e.stop();
		this.diag.log('on hide');
		if (!this.fmShown) {
			return;
		}
		this.fmShown = false;

		// stop hashListener
		if (typeof jsGET !== 'undefined') {
			jsGET.removeListener(this.hashListenerId);
			jsGET.remove(['fmID','fmPath','fmFile','fmListType','fmPageIdx']);
		}

		if (!this.options.hideOverlay) {
			this.overlay.hide();
		}
		this.tips.hide();
		this.browser.empty();
		this.container.setStyle('display', 'none');

		// remove keyboard navigation
		this.diag.log('REMOVE keyboard nav on hide');
		window.removeEvent('scroll', this.bound.scroll).removeEvent('resize', this.bound.scroll);
		document.removeEvent('keydown', this.bound.keydown);
		document.removeEvent('keyup', this.bound.keyup);
		if ((Browser.Engine && (Browser.Engine.trident || Browser.Engine.webkit)) || (Browser.ie || Browser.chrome || Browser.safari))
			document.removeEvent('keydown', this.bound.keyboardInput);
		else
			document.removeEvent('keypress', this.bound.keyboardInput);

		this.fireHooks('cleanup');
		this.fireEvent('hide', [this]);
	},

	// hide the FM info <div>s. do NOT hide the outer info <div> itself, as the Uploader (and possibly other derivatives) may choose to show their own content there!
	show_our_info_sections: function(state) {
		if (!state)
		{
			this.info_head.fade(0).get('tween').chain(function(){
				this.element.setStyle('display', 'none');
			});
			this.preview_area.fade(0).get('tween').chain(function(){
				this.element.setStyle('display', 'none');
			});
		}
		else
		{
			this.info_head.setStyle('display', 'block').fade(1);
			this.preview_area.setStyle('display', 'block').fade(1);
		}
	},

	open_on_click: function(e){
		if (e) e.stop();

		if (!this.Current)
			return;

		var file = this.Current.retrieve('file');
		this.fireEvent('complete', [
			file.path, //this.escapeRFC3986(this.normalize('/' + this.root + file.dir + file.name)), // the absolute URL for the selected file, rawURLencoded
			file,                 // the file specs: .dir, .name, .path, .size, .date, .mime, .icon, .icon48, .thumb48, .thumb250
			this
		]);

// Partikule
// Why Hide ? For some usage, it can be useful to keep it open (more than 3 files and it will be really annoying to re-open the FM for each file select)
		if (this.options.hideOnSelect)
		{
			this.hide();
		}
// /Partikule
	},

	download_on_click: function(e) {
		e.stop();
		if (!this.Current) {
			return;
		}
		this.diag.log('download: ', this.Current.retrieve('file'), this.normalize(this.Current.retrieve('file').path));
		var file = this.Current.retrieve('file');
		this.download(file);
	},

	download: function(file) {
		// the chained display:none code inside the Tips class doesn't fire when the 'Save As' dialog box appears right away (happens in FF3.6.15 at least):
		if (this.tips.tip) {
			this.tips.tip.setStyle('display', 'none');
		}

		// discard old iframe, if it exists:
		if (this.downloadIframe)
		{
			// remove from the menu (dispose) and trash it (destroy)
			this.downloadIframe.dispose().destroy();
			this.downloadIframe = null;
		}
		if (this.downloadForm)
		{
			// remove from the menu (dispose) and trash it (destroy)
			this.downloadForm.dispose().destroy();
			this.downloadForm = null;
		}

		this.downloadIframe = (new IFrame()).set({src: 'about:blank', name: '_downloadIframe'}).setStyles({display:'none'});
		this.menu.adopt(this.downloadIframe);

		this.downloadForm = new Element('form', {target: '_downloadIframe', method: 'post', enctype: 'multipart/form-data'});
		this.menu.adopt(this.downloadForm);

		Object.each(Object.merge(	{},
									this.options.propagateData,
									{
										file: this.normalize(file.dir + file.name),
										filter: this.options.filter
									}),
					function(v, k)
					{
						this.downloadForm.adopt((new Element('input')).set({type: 'hidden', name: k, value: v}));
					}.bind(this));

		this.downloadForm.action = this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString({
			event: 'download'
		  });

		return this.downloadForm.submit();
	},

	create_on_click: function(e) {
		e.stop();
		var input = new Element('input', {'class': 'createDirectory', 'autofocus': 'autofocus'});
		var click_ok_f = function(e) {
			if (e.key === 'enter') {
				e.target.getParent('div.filemanager-dialog').getElement('button.filemanager-dialog-confirm').fireEvent('click');
			}
		};

		new FileManager.Dialog(this.language.createdir, {
			language: {
				confirm: this.language.create,
				decline: this.language.cancel
			},
			content: [
				input
			],
			zIndex: this.options.zIndex + 900,
			onOpen: this.onDialogOpen.bind(this),
			onClose: (function() {
				input.removeEvent('keyup', click_ok_f);
				this.onDialogClose();
			}).bind(this),
			onShow: (function(){
				this.diag.log('add key up on create dialog:onshow');
				input.addEvent('keyup', click_ok_f).focus();
			}).bind(this),
			onConfirm: (function() {
				if (this.Request) this.Request.cancel();

				// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
				this.reset_view_fill_store();

				this.Request = new FileManager.Request({
					url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({}, {
						event: 'create'
					})),
					data: {
						file: input.get('value'),
						directory: this.Directory,
						filter: this.options.filter
					},
					onRequest: function(){},
					onSuccess: (function(j) {
						if (!j || !j.status) {
							this.browserLoader.fade(0);
							return;
						}

						this.deselect();
						this.show_our_info_sections(false);

						// make sure we store the JSON list!
						this.reset_view_fill_store(j);

						// the 'view' request may be an initial reload: keep the startindex (= page shown) intact then:
						this.fill(j, this.get_view_fill_startindex());
						//this.browserLoader.fade(0);
					}).bind(this),
					onComplete: function(){},
					onError: (function(text, error) {
						this.browserLoader.fade(0);
					}).bind(this),
					onFailure: (function(xmlHttpRequest) {
						this.browserLoader.fade(0);
					}).bind(this)
				}, this).send();
			}).bind(this)
		});
	},

	deselect: function(el) {
		if (el && this.Current != el) {
			return;
		}
		this.diag.log('deselect:Current', el);
		if (el) {
			this.fillInfo();
		}
		if (this.Current) {
			this.Current.removeClass('selected');
		}
		this.Current = null;
		this.switchButton4Current();
	},

	// add the ability to preselect a file in the dir
	load: function(dir, preselect) {

		if (typeof preselect === 'undefined') preselect = null;

		this.deselect();
		this.show_our_info_sections(false);

		if (this.Request) this.Request.cancel();

		this.diag.log("### 'view' request: onRequest invoked");

		// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
		this.reset_view_fill_store();

		this.diag.log('view URI: ', this.options.url, dir, this.listType, preselect, this.options.propagateData);
		this.Request = new FileManager.Request({
			url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({}, {
				event: 'view'
			})),
			data: {
				directory: dir,
				filter: this.options.filter,
				file_preselect: (preselect || '')
			},
			onRequest: function(){},
			onSuccess: (function(j) {
				this.diag.log("### 'view' request: onSuccess invoked", j);
				if (!j || !j.status) {
					this.browserLoader.fade(0);
					return;
				}

				// make sure we store the JSON list!
				this.reset_view_fill_store(j);

				// the 'view' request may be an initial reload: keep the startindex (= page shown) intact then:
				// Xinha: add the ability to preselect a file in the dir
				var start_idx = this.get_view_fill_startindex();
				preselect = null;
				if (j.preselect_index > 0)
				{
					start_idx = j.preselect_index - 1;
					preselect = j.preselect_name;
				}
				this.fill(j, start_idx, null, null, preselect);
				//this.browserLoader.fade(0);
			}).bind(this),
			onComplete: (function() {
				this.diag.log("### 'view' request: onComplete invoked");
				this.fitSizes();
			}).bind(this),
			onError: (function(text, error) {
				// a JSON error
				this.diag.log("### 'view' request: onError invoked", text, error);
				this.browserLoader.fade(0);
			}).bind(this),
			onFailure: (function(xmlHttpRequest) {
				// a generic (non-JSON) communication failure
				this.diag.log("### 'view' request: onFailure invoked", xmlHttpRequest);
				this.browserLoader.fade(0);
			}).bind(this)
		}, this).send();
	},

	delete_from_dircache: function(file)
	{
		var items;
		var i;

		if (this.view_fill_json)
		{
			if (file.mime === 'text/directory')
			{
				items = this.view_fill_json.dirs;
			}
			else
			{
				items = this.view_fill_json.files;
			}

			for (i = items.length - 1; i >= 0; i--)
			{
				var item = items[i];
				if (item.name === file.name)
				{
					items.splice(i, 1);
					break;
				}
			}
		}
	},

	destroy_noQasked: function(file) {

		if (this.Request) this.Request.cancel();

		this.browserLoader.fade(1);

		this.Request = new FileManager.Request({
			url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({}, {
				event: 'destroy'
			})),
			data: {
				file: file.name,
				directory: this.Directory,
				filter: this.options.filter
			},
			onRequest: function(){},
			onSuccess: (function(j) {
				if (!j || !j.status) {
					this.browserLoader.fade(0);
					return;
				}

				this.fireEvent('modify', [Object.clone(file), j, 'destroy', this]);

				// remove entry from cached JSON directory list and remove the item from the view.
				// This is particularly important when working on a paginated directory and afterwards the pages are jumped back & forth:
				// the next time around, this item should NOT appear in the list anymore!
				this.deselect(file.element);

				var rerendering_list = false;
				if (this.view_fill_json)
				{
					this.delete_from_dircache(file);  /* do NOT use j.name, as that one can be 'cleaned up' as part of the 'move' operation! */

					// minor caveat: when we paginate the directory list, then browsing to the next page will skip one item (which would
					// have been the first on the next page). The brute-force fix for this is to force a re-render of the page when in
					// pagination view mode:
					if (this.view_fill_json.dirs.length + this.view_fill_json.files.length > this.listPaginationLastSize)
					{
						// similar activity as load(), but without the server communication...

						// if (this.Request) this.Request.cancel();

						// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
						//this.reset_view_fill_store();
						clearTimeout(this.view_fill_timer);
						this.view_fill_timer = null;

						rerendering_list = true;
						this.fill(null, this.get_view_fill_startindex(), this.listPaginationLastSize);
					}
				}
				// make sure fade does not clash with parallel directory (re)load:
				if (!rerendering_list)
				{
					var p = file.element.getParent();
					if (p) {
						p.fade(0).get('tween').chain(function(){
							this.element.destroy();
						});
					}
				}
				this.browserLoader.fade(0);
			}).bind(this),
			onComplete: function(){},
			onError: (function(text, error) {
				this.browserLoader.fade(0);
			}).bind(this),
			onFailure: (function(xmlHttpRequest) {
				this.browserLoader.fade(0);
			}).bind(this)
		}, this).send();
	},

	destroy: function(file){
		if (this.options.hideQonDelete) {
			this.destroy_noQasked(file);
		}
		else {
			new FileManager.Dialog(this.language.destroyfile, {
				language: {
					confirm: this.language.destroy,
					decline: this.language.cancel
				},
				zIndex: this.options.zIndex + 900,
				onOpen: this.onDialogOpen.bind(this),
				onClose: this.onDialogClose.bind(this),
				onConfirm: (function() {
					this.destroy_noQasked(file);
				}).bind(this)
			});
		}
	},

	rename: function(file) {
		var name = file.name;
		var input = new Element('input', {'class': 'rename', value: name, 'autofocus': 'autofocus'});

		// if (file.mime !== 'text/directory') name = name.replace(/\..*$/, '');     -- unused

		new FileManager.Dialog(this.language.renamefile, {
			language: {
				confirm: this.language.rename,
				decline: this.language.cancel
			},
			content: [
				input
			],
			zIndex: this.options.zIndex + 900,
			onOpen: this.onDialogOpen.bind(this),
			onClose: this.onDialogClose.bind(this),
			onShow: (function(){
				this.diag.log('add key up on rename dialog:onshow');
				input.addEvent('keyup', function(e) {
					if (e.key === 'enter') {
						e.target.getParent('div.filemanager-dialog').getElement('button.filemanager-dialog-confirm').fireEvent('click');
					}
				}).focus();
			}).bind(this),
			onConfirm: (function(){
				if (this.Request) this.Request.cancel();

				this.browserLoader.fade(1);

				this.Request = new FileManager.Request({
					url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({},  {
						event: 'move'
					})),
					data: {
						file: file.name,
						name: input.get('value'),
						directory: this.Directory,
						filter: this.options.filter
					},
					onRequest: function(){},
					onSuccess: (function(j) {
						if (!j || !j.status) {
							this.browserLoader.fade(0);
							return;
						}
						this.fireEvent('modify', [Object.clone(file), j, 'rename', this]);
						file.element.getElement('span.filemanager-filename').set('text', j.name).set('title', j.name);
						file.element.addClass('selected');
						file.name = j.name;
						this.diag.log('move : onSuccess: fillInfo: file = ', file);
						this.fillInfo(file);
						this.browserLoader.fade(0);
					}).bind(this),
					onComplete: function(){},
					onError: (function(text, error) {
						this.browserLoader.fade(0);
					}).bind(this),
					onFailure: (function(xmlHttpRequest) {
						this.browserLoader.fade(0);
					}).bind(this)
				}, this).send();
			}).bind(this)
		});
	},

	browserSelection: function(direction) {
		var csel;

		this.diag.log('browserSelection : direction = ', direction);
		if (this.browser.getElement('li') == null) return;

		if (direction === 'go-bottom')
		{
			// select first item of next page
			current = this.browser.getFirst('li').getElement('span.fi');

			// blow away any lingering 'selected' after a page switch like that
			csel = this.browser.getElement('span.fi.selected');
			if (csel != null)
				csel.removeClass('selected');
		}
		else if (direction === 'go-top')
		{
			// select last item of previous page
			current = this.browser.getLast('li').getElement('span.fi');

			// blow away any lingering 'selected' after a page switch like that
			csel = this.browser.getElement('span.fi.selected');
			if (csel != null)
				csel.removeClass('selected');
		}
		else if (this.browser.getElement('span.fi.hover') == null && this.browser.getElement('span.fi.selected') == null)
		{
			// none is selected: select first item (folder/file)
			current = this.browser.getFirst('li').getElement('span.fi');
		}
		else
		{
			// select the current file/folder or the one with hover
			var current = null;
			if (this.browser.getElement('span.fi.hover') == null && this.browser.getElement('span.fi.selected') != null) {
				current = this.browser.getElement('span.fi.selected');
			}
			else if (this.browser.getElement('span.fi.hover') != null) {
				current = this.browser.getElement('span.fi.hover');
			}
		}

		this.browser.getElements('span.fi.hover').each(function(span){
			span.removeClass('hover');
		});

		var stepsize = 1, next, currentFile;

		switch (direction) {
		// go down
		case 'end':
			stepsize = 1E5;
			/* fallthrough */
		case 'pagedown':
			if (stepsize == 1) {
				if (current.getPosition(this.browserScroll).y + current.getSize().y * 2 < this.browserScroll.getSize().y) {
					stepsize = Math.floor((this.browserScroll.getSize().y - current.getPosition(this.browserScroll).y) / current.getSize().y) - 1;
					if (stepsize < 1)
						stepsize = 1;
				}
				else {
					stepsize = Math.floor(this.browserScroll.getSize().y / current.getSize().y);
				}
			}
			/* fallthrough */
		case 'down':
			current = current.getParent('li');
			this.diag.log('key DOWN: stepsize = ', stepsize);

			// when we're at the bottom of the view and there are more pages, go to the next page:
			next = current.getNext('li');
			if (next == null)
			{
				if (this.paging_goto_next(null, 'go-bottom'))
					break;
			}
			else
			{
				for ( ; stepsize > 0; stepsize--) {
					next = current.getNext('li');
					if (next == null)
						break;
					current = next;
				}
			}
			current = current.getElement('span.fi');
			/* fallthrough */
		case 'go-bottom':        // 'faked' key sent when done shifting one pagination page down
			current.addClass('hover');
			this.Current = current;
			direction = 'down';
			break;

		// go up
		case 'home':
			stepsize = 1E5;
			/* fallthrough */
		case 'pageup':
			if (stepsize == 1) {
				// when at the top of the viewport, a full page scroll already happens /visually/ when you go up 1: that one will end up at the /bottom/, after all.
				stepsize = Math.floor(current.getPosition(this.browserScroll).y / current.getSize().y);
				if (stepsize < 1)
					stepsize = 1;
			}
			/* fallthrough */
		case 'up':
			current = current.getParent('li');
			this.diag.log('key UP: stepsize = ', stepsize);

			// when we're at the top of the view and there are pages before us, go to the previous page:
			var previous = current.getPrevious('li');
			if (previous == null)
			{
				if (this.paging_goto_prev(null, 'go-top'))
					break;
			}
			else
			{
				for ( ; stepsize > 0; stepsize--) {
					previous = current.getPrevious('li');
					if (previous == null)
						break;
					current = previous;
				}
			}
			current = current.getElement('span.fi');
			/* fallthrough */
		case 'go-top':        // 'faked' key sent when done shifting one pagination page up
			current.addClass('hover');
			this.Current = current;
			direction = 'up';
			break;

		case 'none':        // 'faked' key sent when picking a row 'remotely', i.e. when we don't know where we are currently, but when we want to scroll to 'current' anyhow
			current.addClass('hover');
			this.Current = current;
			break;

		// select
		case 'enter':
			this.storeHistory = true;
			this.Current = current;
			csel = this.browser.getElement('span.fi.selected');
			if (csel != null) // remove old selected one
				csel.removeClass('selected');

			current.addClass('selected');
			currentFile = current.retrieve('file');
			this.diag.log('on key ENTER file = ', currentFile);
			if (currentFile.mime === 'text/directory') {
				this.load(currentFile.dir + currentFile.name /*.replace(this.root,'')*/);
			}
			else {
				this.fillInfo(currentFile);
			}
			break;

		// delete file/directory:
		case 'delete':
			this.storeHistory = true;
			this.Current = current;
			this.browser.getElements('span.fi.selected').each(function(span) {
				span.removeClass('selected');
			});

			// and before we go and delete the entry, see if we pick the next one down or up as our next cursor position:
			var parent = current.getParent('li');
			next = parent.getNext('li');
			if (next == null) {
				next = parent.getPrevious('li');
			}
			if (next != null) {
				next = next.getElement('span.fi');
				next.addClass('hover');
			}

			currentFile = current.retrieve('file');
			this.diag.log('on key DELETE file = ', currentFile);
			this.destroy(currentFile);

			current = next;
			this.Current = current;
			break;
		}

		// make sure to scroll the view so the selected/'hovered' item is within visible range:

		this.diag.log('key DOWN: current Y = ' + current.getPosition(this.browserScroll).y + ', H = ' + this.browserScroll.getSize().y + ', 1U = ' + current.getSize().y);
		this.diag.log('key UP: current Y = ' + current.getPosition(this.browserScroll).y + ', H = ' + this.browserScroll.getSize().y + ', 1U = ' + current.getSize().y + ', SCROLL = ' + this.browserScroll.getScroll().y + ', SIZE = ' + this.browserScroll.getSize().y);
		var dy, browserScrollFx;
		if (direction !== 'up' && current.getPosition(this.browserScroll).y + current.getSize().y * 2 >= this.browserScroll.getSize().y)
		{
			// make scroll duration slightly dependent on the distance to travel:
			dy = (current.getPosition(this.browserScroll).y + current.getSize().y * 2 - this.browserScroll.getSize().y);
			dy = 50 * dy / this.browserScroll.getSize().y;
			this.diag.log('key UP: DUR: ', dy);
			browserScrollFx = new Fx.Scroll(this.browserScroll, { duration: (dy < 150 ? 150 : dy > 1000 ? 1000 : dy.toInt()) });
			browserScrollFx.toElement(current);
		}
		else if (direction !== 'down' && current.getPosition(this.browserScroll).y <= current.getSize().y)
		{
			var sy = this.browserScroll.getScroll().y + current.getPosition(this.browserScroll).y - this.browserScroll.getSize().y + current.getSize().y * 2;

			// make scroll duration slightly dependent on the distance to travel:
			dy = this.browserScroll.getScroll().y - sy;
			dy = 50 * dy / this.browserScroll.getSize().y;
			this.diag.log('key UP: SY = ' + sy + ', DUR: ' + dy);
			browserScrollFx = new Fx.Scroll(this.browserScroll, { duration: (dy < 150 ? 150 : dy > 1000 ? 1000 : dy.toInt()) });
			browserScrollFx.start(current.getPosition(this.browserScroll).x, (sy >= 0 ? sy : 0));
		}
	},

	// -> cancel dragging
	revert_drag_n_drop: function(el) {
		el.fade(1).removeClass('drag').removeClass('move').setStyles({
			'z-index': 'auto',
			position: 'relative',
			width: 'auto',
			left: 0,
			top: 0
		}).inject(el.retrieve('parent'));
		// also dial down the opacity of the icons within this row (download, rename, delete):
		var icons = el.getElements('img.browser-icon');
		if (icons) {
			icons.each(function(icon) {
				icon.fade(0);
			});
		}

		this.diag.log('DISABLE keyboard up/down on revert');
		//document.removeEvent('keydown', this.bound.keydown).removeEvent('keyup', this.bound.keyup);
		this.drag_is_active = false;
		this.imageadd.fade(0);

		//this.relayClick.apply(this, [null, el]);
	},

	// clicked 'first' button in the paged list/thumb view:
	paging_goto_prev: function(e, kbd_dir)
	{
		if (e) e.stop();
		var startindex = this.get_view_fill_startindex();
		if (!startindex)
			return false;

		return this.paging_goto_helper(startindex - this.listPaginationLastSize, this.listPaginationLastSize, kbd_dir);
	},
	paging_goto_next: function(e, kbd_dir)
	{
		if (e) e.stop();
		var startindex = this.get_view_fill_startindex();
		if (this.view_fill_json && startindex > this.view_fill_json.dirs.length + this.view_fill_json.files.length - this.listPaginationLastSize)
			return false;

		return this.paging_goto_helper(startindex + this.listPaginationLastSize, this.listPaginationLastSize, kbd_dir);
	},
	paging_goto_first: function(e, kbd_dir)
	{
		if (e) e.stop();
		var startindex = this.get_view_fill_startindex();
		if (!startindex)
			return false;

		return this.paging_goto_helper(0, null, kbd_dir);
	},
	paging_goto_last: function(e, kbd_dir)
	{
		if (e) e.stop();
		var startindex = this.get_view_fill_startindex();
		if (this.view_fill_json && startindex > this.view_fill_json.dirs.length + this.view_fill_json.files.length - this.options.listPaginationSize)
			return false;

		return this.paging_goto_helper(2E9 /* ~ maxint */, null, kbd_dir);
	},
	paging_goto_helper: function(startindex, pagesize, kbd_dir)
	{
		// similar activity as load(), but without the server communication...
		this.deselect();
		this.show_our_info_sections(false);

		// if (this.Request) this.Request.cancel();

		// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
		//this.reset_view_fill_store();
		clearTimeout(this.view_fill_timer);
		this.view_fill_timer = null;

		return this.fill(null, startindex, pagesize, kbd_dir);
	},

	fill: function(j, startindex, pagesize, kbd_dir, preselect)
	{
		var j_item_count;

		if (typeof preselect === 'undefined') preselect = null;

		if (!pagesize)
		{
			pagesize = this.options.listPaginationSize;
			this.listPaginationLastSize = pagesize;
		}
		// else: pagesize specified means stick with that one. (useful to keep pagesize intact when going prev/next)

		if (!j)
		{
			j = this.view_fill_json;
		}

		j_item_count = j.dirs.length + j.files.length;

		startindex = parseInt(startindex, 10);     // make sure it's an int number
		if (isNaN(startindex))
		{
			startindex = 0;
		}

		if (!pagesize)
		{
			// no paging: always go to position 0 then!
			startindex = 0;
		}
		else if (startindex > j_item_count)
		{
			startindex = j_item_count;
		}
		else if (startindex < 0)
		{
			startindex = 0;
		}
		// always make sure startindex is exactly on a page edge: this is important to keep the page numbers
		// in the tooltips correct!
		startindex = Math.floor(startindex / pagesize);
		startindex *= pagesize;

		// keyboard navigation sets the 'hover' class on the 'current' item: remove any of those:
		this.browser.getElements('span.fi.hover').each(function(span){
			span.removeClass('hover');
		});

		this.root = j.root;
		this.Directory = j.path;
		this.CurrentDir = j.dir;
		if (!this.onShow) {
			this.diag.log('fill internal: fillInfo: file = ', j, j.dir);
			this.fillInfo(j.dir); // XXXX
		}
		this.browser.empty();

// Partikule
// Add of the thumbnail list in the preview panel: blow away any pre-existing list now, as we'll generate a new one now:

		this.dir_filelist.empty();

// /Partikule

		// set history
		if (typeof jsGET !== 'undefined' && this.storeHistory && j.dir.mime === 'text/directory')
		{
			jsGET.set({'fmPath': j.path});
		}

		this.CurrentPath = this.normalize(this.root + this.Directory);
		var text = [], pre = [];
		// on error reported by backend, there WON'T be a JSON 'root' element at all times:
		//
		// TODO: how to handle that error condition correctly?
		if (!j.root)
		{
			this.showError('' + j.error);
			return false;
		}
		var rootPath = j.root.slice(0,-1).split('/');
		rootPath.pop();
		this.CurrentPath.split('/').each((function(folderName){
			if (!folderName) return;

			pre.push(folderName);
			var path = ('/'+pre.join('/')+'/').replace(j.root,'');
			this.diag.log('on fill file = ' + j.root + ' : ' + path + ' : ' + folderName + ', source = ' + 'JSON');
			if (rootPath.contains(folderName)) {
				// add non-clickable path
				text.push(new Element('span', {'class': 'icon', text: folderName}));
			} else {
				// add clickable path
				text.push(new Element('a', {
						'class': 'icon',
						href: '#',
						text: folderName
					}).addEvent('click', (function(e){
						this.diag.log('path section - click event: ' + e.target + ' (' + path + ') : ' + e.type + ' @ ' + e.target.outerHTML);
						e.stop();
						this.load(path);
					}).bind(this))
				);
			}
			text.push(new Element('span', {text: ' / '}));
		}).bind(this));

		text.pop();
		text[text.length-1].addClass('selected').removeEvents('click').addEvent('click', (function(e) {
			e.stop();
			// show the 'directory' info in the detail pane again (this is a way to get back from previewing single files to previewing the directory as a gallery)
			this.diag.log('click: fillInfo: current directory!');
			this.fillInfo();
		}).bind(this));
		this.selectablePath.set('value', '/'+this.CurrentPath);
		this.clickablePath.empty().adopt(new Element('span', {text: '/ '}), text);

		if (!j.dirs || !j.files) {
			return false;
		}

		// ->> generate browser list
		var els = [[], []];

		/*
		 * For very large directories, where the number of directories in there and/or the number of files is HUGE (> 200),
		 * we DISABLE drag&drop functionality.
		 *
		 * Yes, we could have opted for the alternative, which is splitting up the .makeDraggable() activity in multiple
		 * setTimeout(callback, 0) initiated chunks in order to spare the user the hassle of a 'slow script' dialog,
		 * but in reality drag&drop is ludicrous in such an environment; currently we do not (yet) support autoscrolling
		 * the list to enable drag&dropping it to elements further away that the current viewport can hold at the same time,
		 * but drag&drop in a 500+ image carrying directory is resulting in a significant load of the browser anyway;
		 * alternative means to move/copy files should be provided in such cases instead.
		 *
		 * Hence we run through the list here and abort / limit the drag&drop assignment process when the hardcoded number of
		 * directories or files have been reached (support_DnD_for_this_dir).
		 *
		 * TODO: make these numbers 'auto adaptive' based on timing measurements: how long does it take to initialize
		 *       a view on YOUR machine? --> adjust limits accordingly.
		 */
		var support_DnD_for_this_dir = this.allow_DnD(j, pagesize);
		var starttime = new Date().getTime();
		this.diag.log('fill list size = ' + j_item_count);

		var endindex = j_item_count;
		var paging_now = 0;
		if (pagesize)
		{
			// endindex MAY point beyond j_item_count; that's okay; we check the boundary every time in the other fill chunks.
			endindex = startindex + pagesize;
			// however for reasons of statistics gathering, we keep it bound to j_item_count at the moment:
			if (endindex > j_item_count) endindex = j_item_count;

			if (pagesize < j_item_count)
			{
				var pagecnt = Math.ceil(j_item_count / pagesize);
				var curpagno = Math.floor(startindex / pagesize) + 1;

				this.browser_paging_info.set('text', '' + curpagno + '/' + pagecnt);

				if (curpagno > 1)
				{
					this.browser_paging_first.set('title', this.language.goto_page + ' 1');
					this.browser_paging_first.fade(1);
					this.browser_paging_prev.set('title', this.language.goto_page + ' ' + (curpagno - 1));
					this.browser_paging_prev.fade(1);
				}
				else
				{
					this.browser_paging_first.set('title', '---');
					this.browser_paging_first.fade(0.25);
					this.browser_paging_prev.set('title', '---');
					this.browser_paging_prev.fade(0.25);
				}
				if (curpagno < pagecnt)
				{
					this.browser_paging_last.set('title', this.language.goto_page + ' ' + pagecnt);
					this.browser_paging_last.fade(1);
					this.browser_paging_next.set('title', this.language.goto_page + ' ' + (curpagno + 1));
					this.browser_paging_next.fade(1);
				}
				else
				{
					this.browser_paging_last.set('title', '---');
					this.browser_paging_last.fade(0.25);
					this.browser_paging_next.set('title', '---');
					this.browser_paging_next.fade(0.25);
				}

				paging_now = 1;
			}
		}
		this.browser_paging.fade(paging_now);
		// fix for MSIE8: also fade out the pagination icons themselves
		if (!paging_now)
		{
			this.browser_paging_first.fade(0);
			this.browser_paging_prev.fade(0);
			this.browser_paging_last.fade(0);
			this.browser_paging_next.fade(0);
		}

		// remember pagination position history
		this.store_view_fill_startindex(startindex);

		this.view_fill_timer = this.fill_chunkwise_1.delay(1, this, [startindex, endindex, endindex - startindex, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir, preselect]);

		return true;
	},

	list_row_maker: function(thumbnail_url, file)
	{
		return file.element = new Element('span', {'class': 'fi ' + this.listType, href: '#'}).adopt(
			new Element('span', {
				'class': this.listType,
				'styles': {
					'background-image': 'url(' + (thumbnail_url ? thumbnail_url : this.assetBasePath + 'Images/loader.gif') + ')'
				}
			}).addClass('fm-thumb-bg'),
			new Element('span', {'class': 'filemanager-filename', text: file.name, title: file.name})
		).store('file', file);
	},

	dir_gallery_item_maker: function(thumbnail_url, file)
	{
		// as we want the thumbnails line up reasonably well in a grid and have no huge white areas thanks to long filenames,
		// we strip the filename on display. When the user wishes to know the full filename, he can hover over the image, anyway.
		var fname = file.name;
		if (fname.length > 6)
		{
			fname = fname.substr(0, 6) + '...';
		}

		var el = new Element('div', {
			'class': 'fi',
			'title': file.name
		}).adopt(
			new Element('div', {
				'class': 'dir-gal-thumb-bg',
				'styles': {
					'background-image': 'url(' + (thumbnail_url ? thumbnail_url : this.assetBasePath + 'Images/loader.gif') + ')',
					'width': 48,
					'height': 48
				}
			}),
			new Element('div', {
				'class': 'name',
				'text': fname
			})
		);
		this.tips.attach(el);
		return el;
	},

	/*
	 * The old one-function-does-all fill() would take an awful long time when processing large directories. This function
	 * contains the most costly code chunk of the old fill() and has adjusted the looping through the j.dirs[] and j.files[] lists
	 * in such a way that we can 'chunk it up': we can measure the time consumed so far and when we have spent more than
	 * X milliseconds in the loop, we stop and allow the loop to commence after a minimal delay.
	 *
	 * The delay is the way to relinquish control to the browser and as a thank-you NOT get the dreaded
	 * 'slow script, continue or abort?' dialog in your face. Ahh, the joy of cooperative multitasking is back again! :-)
	 */
	fill_chunkwise_1: function(startindex, endindex, render_count, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir, preselect) {

		var idx, file, loop_duration;
		var self = this;
		var j = this.view_fill_json;
		var loop_starttime = new Date().getTime();
		var fmFile = (typeof jsGET !== 'undefined' ? jsGET.get('fmFile') : null);

		var duration = new Date().getTime() - starttime;
		this.diag.log(' + fill_chunkwise_1(' + startindex + ') @ ' + duration);

		/*
		 * Note that the '< j.dirs.length' / '< j.files.length' checks MUST be kept around: one of the fastest ways to abort/cancel
		 * the render is emptying the dirs[] + files[] array, as that would abort the loop on the '< j.dirs.length' / '< j.files.length'
		 * condition.
		 *
		 * This, together with killing our delay-timer, is done when anyone calls reset_view_fill_store() to
		 * abort this render pronto.
		 */

		// first loop: only render directories, when the indexes fit the range: 0 .. j.dirs.length-1
		// Assume several directory aspects, such as no thumbnail hassle (it's one of two icons anyway, really!)
		var el, editButtons;

		for (idx = startindex; idx < endindex && idx < j.dirs.length; idx++)
		{
			file = j.dirs[idx];

			if (idx % 10 == 0) {
				// try not to spend more than 100 msecs per (UI blocking!) loop run!
				loop_duration = new Date().getTime() - loop_starttime;
				duration = new Date().getTime() - starttime;
				this.diag.log('time taken so far = ' + duration + ' / ' + loop_duration + ' @ elcnt = ' + idx);

				/*
				 * Are we running in adaptive pagination mode? yes: calculate estimated new pagesize and adjust average (EMA) when needed.
				 *
				 * Do this here instead of at the very end so that pagesize will adapt, particularly when user does not want to wait for
				 * this render to finish.
				 */
				this.adaptive_update_pagination_size(idx, endindex, render_count, pagesize, duration, 1.0 / 7.0, 1.1, 0.1 / 1000);

				if (loop_duration >= 100)
				{
					this.view_fill_timer = this.fill_chunkwise_1.delay(1, this, [idx, endindex, render_count, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir, preselect]);
					return; // end call == break out of loop
				}
			}

			file.dir = j.path;

			this.diag.log('thumbnail: "' + file.icon48 + '"');
			//var icon = (this.listType === 'thumb') ? new Asset.image(file.thumb48 /* +'?'+uniqueId */, {'class':this.listType}) : new Asset.image(file.thumb48);

			// This is just a raw image
			el = this.list_row_maker((this.listType === 'thumb' ? file.icon48 : file.icon), file);

			this.diag.log('add DIRECTORY click event to ' + file.name);
			el.addEvent('click', (function(e) {
				self.diag.log('is_dir:CLICK: ' + e.target + ': ' + e.type + ' @ ' + e.target.outerHTML);
				//var node = $((event.currentTarget) ? e.event.currentTarget : e.event.srcElement);
				//var node = el;
				var node = this;
				self.relayClick.apply(self, [e, node]);
			}).bind(el));

			// -> add icons
			//var icons = [];
			editButtons = [];

			// rename, delete icon
			if (file.name !== '..')
			{
				if (this.options.rename) editButtons.push('rename');
				if (this.options.destroy) editButtons.push('destroy');
			}

			editButtons.each(function(v){
				//icons.push(
				new Asset.image(this.assetBasePath + 'Images/' + v + '.png', {title: this.language[v]}).addClass('browser-icon').set('opacity', 0).addEvent('mouseup', (function(e, target){
					// this = el, self = FM instance
					e.preventDefault();
					this.store('edit', true);
					// can't use 'file' in here directly anymore either:
					var file = this.retrieve('file');
					self.tips.hide();
					self[v](file);
				}).bind(el)).inject(el,'top');
				//);
			}, this);

			els[1].push(el);
			//if (file.name === '..') el.fade(0.7);
			el.inject(new Element('li',{'class':this.listType}).inject(this.browser)).store('parent', el.getParent());
			//icons = $$(icons.map((function(icon){
			//  this.showFunctions(icon,icon,0.5,1);
			//  this.showFunctions(icon,el.getParent('li'),1);
			//}).bind(this)));

			// you CANNOT 'preselect' a directory as if it were a file, so we don't need to check against the 'preselect' or 'fmFile' values here!
		}

		// and another, ALMOST identical, loop to render the files. Note that these buggers have their own peculiarities... and make sure the index is adjusted to point into files[]
		var dir_count = j.dirs.length;

		// skip files[] rendering, when the startindex still points inside dirs[]  ~  too many directories to fit any files on this page!
		if (idx >= dir_count)
		{
			var dg_el;

			for ( ; idx < endindex && idx - dir_count < j.files.length; idx++)
			{
				file = j.files[idx - dir_count];

				if (idx % 10 == 0) {
					// try not to spend more than 100 msecs per (UI blocking!) loop run!
					loop_duration = new Date().getTime() - loop_starttime;
					duration = new Date().getTime() - starttime;
					this.diag.log('time taken so far = ' + duration + ' / ' + loop_duration + ' @ elcnt = ' + idx);

					/*
					 * Are we running in adaptive pagination mode? yes: calculate estimated new pagesize and adjust average (EMA) when needed.
					 *
					 * Do this here instead of at the very end so that pagesize will adapt, particularly when user does not want to wait for
					 * this render to finish.
					 */
					this.adaptive_update_pagination_size(idx, endindex, render_count, pagesize, duration, 1.0 / 7.0, 1.1, 0.1 / 1000);

					if (loop_duration >= 100)
					{
						this.view_fill_timer = this.fill_chunkwise_1.delay(1, this, [idx, endindex, render_count, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir, preselect]);
						return; // end call == break out of loop
					}
				}

				file.dir = j.path;

				this.diag.log('thumbnail: "' + file.thumb48 + '"');
				//var icon = (this.listType === 'thumb') ? new Asset.image(file.thumb48 /* +'?'+uniqueId */, {'class':this.listType}) : new Asset.image(file.thumb48);

				// As we now have two views into the directory, we have to fetch the thumbnails, even when we're in 'list' view: the direcory gallery will need them!
				// Besides, fetching the thumbs and all right after we render the directory also makes these thumbs + metadata available for drag&drop gallery and
				// 'select mode', so they don't always have to ask for the meta data when it is required there and then.
				if (file.thumb48 || /* this.listType !== 'thumb' || */ !file.thumbs_deferred)
				{
					// This is just a raw image
					el = this.list_row_maker((this.listType === 'thumb' ? (file.thumb48 ? file.thumb48 : file.icon48) : file.icon), file);

					dg_el = this.dir_gallery_item_maker((file.thumb48 ? file.thumb48 : file.icon48), file);
				}
				else	// thumbs_deferred...
				{
					// We must AJAX POST our propagateData, so we need to do the post and take the url to the
					// thumbnail from the post results.
					//
					// The alternative here, taking only 1 round trip instead of 2, would have been to FORM POST
					// to a tiny iframe, which is suitably sized to contain the generated thumbnail and the POST
					// actually returning the binary image data, thus the iframe contents becoming the thumbnail image.

					// update this one alongside the 'el':
					dg_el = this.dir_gallery_item_maker(file.icon48, file);

					el = (function(file, dg_el) {           // Closure
						var iconpath = this.assetBasePath + 'Images/Icons/' + (this.listType === 'thumb' ? 'Large/' : '') + 'default-error.png';
						var list_row = this.list_row_maker(file.icon48, file);

						var req = new FileManager.Request({
							url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({},  {
								//event: 'thumbnail'
								event: 'detail'
							})),
							data: {
								directory: file.dir,
								file: file.name,
								filter: this.options.filter,
								mode: 'direct'
							},
							fmDisplayErrors: false,   // Should we display the error here? No, we just display the general error icon instead
							onRequest: function(){},
							onSuccess: (function(j) {
								if (!j || !j.status || !j.thumb48)
								{
									list_row.getElement('span.fm-thumb-bg').setStyle('background-image', 'url(' + (this.listType === 'thumb' ? (j.icon48 ? j.icon48 : iconpath) : (j.icon ? j.icon : iconpath)) + ')');
									dg_el.getElement('div.dir-gal-thumb-bg').setStyle('background-image', 'url(' + (j.icon48 ? j.icon48 : iconpath) + ')');
								}
								else
								{
									list_row.getElement('span.fm-thumb-bg').setStyle('background-image', 'url(' + (this.listType === 'thumb' ? j.thumb48 : j.icon) + ')');
									dg_el.getElement('div.dir-gal-thumb-bg').setStyle('background-image', 'url(' + j.thumb48 + ')');
								}

								// update the stored json for this file as well:
								file = Object.merge(file, j);

								delete file.thumbs_deferred;
								delete file.error;
								delete file.status;
								delete file.content;

								if (file.element)
								{
									file.element.store('file', file);
								}
							}).bind(this),
							onError: (function(text, error) {
								list_row.getElement('span.fm-thumb-bg').setStyle('background-image', 'url(' + iconpath + ')');
								dg_el.getElement('div.dir-gal-thumb-bg').setStyle('background-image', 'url(' + iconpath + ')');
							}).bind(this),
							onFailure: (function(xmlHttpRequest) {
								list_row.getElement('span.fm-thumb-bg').setStyle('background-image', 'url(' + iconpath + ')');
								dg_el.getElement('div.dir-gal-thumb-bg').setStyle('background-image', 'url(' + iconpath + ')');
							}).bind(this)
						}, this);

						this.RequestQueue.addRequest(String.uniqueID(), req);
						req.send();

						return list_row;
					}).bind(this)(file, dg_el);
				}

				/*
				 * WARNING: for some (to me) incomprehensible reason the old code which bound the event handlers to 'this==self' and which used the 'el' variable
				 *          available here, does NOT WORK ANY MORE - tested in FF3.6. Turns out 'el' is pointing anywhere but where you want it by the time
				 *          the event handler is executed.
				 *
				 *          The 'solution' which I found was to rely on the 'self' reference instead and bind to 'el'. If the one wouldn't work, the other shouldn't,
				 *          but there you have it: this way around it works. FF3.6.14 :-(
				 *
				 * EDIT 2011/03/16: the problem started as soon as the old Array.each(function(...){...}) by the chunked code which uses a for loop:
				 *
				 *              http://jibbering.com/faq/notes/closures/
				 *
				 *          as it says there:
				 *
				 *              A closure is formed when one of those inner functions is made accessible outside of the function in which it was
				 *              contained, so that it may be executed after the outer function has returned. At which point it still has access to
				 *              the local variables, parameters and inner function declarations of its outer function. Those local variables,
				 *              parameter and function declarations (initially) >>>> have the values that they had when the outer function returned <<<<
				 *              and may be interacted with by the inner function.
				 *
				 *          The >>>> <<<< emphasis is mine: in the .each() code, each el was a separate individual, while due to the for loop,
				 *          the last 'el' to exist at all is the one created during the last round of the loop in that chunk. Which explains the
				 *          observed behaviour before the fix: the file names associated with the 'el' element object were always pointing
				 *          at some item further down the list, not necessarily the very last one, but always these references were 'grouped':
				 *          multiple rows would produce the same filename.
				 *
				 * EXTRA: 2011/04/09: why you don't want to add this event for any draggable item!
				 *
				 *          It turns out that IE9 (IE6-8 untested as I write this) and Opera do NOT fire the 'click' event after the drag operation is
				 *          'cancel'led, while other browsers fire both (Chrome/Safari/FF3).
				 *          For the latter ones, the event handler sequence after a simple click on a draggable item is:
				 *            - Drag::onBeforeStart
				 *            - Drag::onCancel
				 *            - 'click'
				 *          while a tiny amount of dragging produces this sequence instead:
				 *            - Drag::onBeforeStart
				 *            - Drag::onStart
				 *            - Drag::onDrop
				 *            - 'click'
				 *
				 *          Meanwhile, Opera and IE9 do this:
				 *            - Drag::onBeforeStart
				 *            - Drag::onCancel
				 *            - **NO** click event!
				 *          while a tiny amount of dragging produces this sequence instead:
				 *            - Drag::onBeforeStart
				 *            - Drag::onStart
				 *            - Drag::onDrop
				 *            - **NO** click event!
				 *
				 *          which explains why the old implementation did not simply register this 'click' event handler and had 'revert' fake the 'click'
				 *          event instead.
				 *          HOWEVER, the old way, using revert() (now called revert_drag_n_drop()) was WAY too happy to hit the 'click' event handler. In
				 *          fact, the only spot where such 'manually firing' was desirable is when the drag operation is CANCELLED. And only there!
				 */

				// 2011/04/09: only register the 'click' event when the element is NOT a draggable:
				if (!support_DnD_for_this_dir)
				{
					self.diag.log('add FILE click event to ' + file.name + ' : ' + file.mime);
					el.addEvent('click', (function(e) {
						self.diag.log('is_file:CLICK: ' + e.target + ': ' + e.type + ' @ ' + e.target.outerHTML);
						//var node = $((event.currentTarget) ? e.event.currentTarget : e.event.srcElement);
						//var node = el;
						var node = this;
						self.relayClick.apply(self, [e, node]);
					}).bind(el));
				}

				// -> add icons
				//var icons = [];
				editButtons = [];
				// download icon
				if (this.options.download) {
					if (this.options.download) editButtons.push('download');
				}

				// rename, delete icon
				if (this.options.rename) editButtons.push('rename');
				if (this.options.destroy) editButtons.push('destroy');

				editButtons.each(function(v){
					//icons.push(
					new Asset.image(this.assetBasePath + 'Images/' + v + '.png', {title: this.language[v]}).addClass('browser-icon').set('opacity', 0).addEvent('mouseup', (function(e, target){
						// this = el, self = FM instance
						e.preventDefault();
						this.store('edit', true);
						// can't use 'file' in here directly anymore either:
						var file = this.retrieve('file');
						self.tips.hide();
						self[v](file);
					}).bind(el)).inject(el,'top');
					//);
				}, this);

				els[0].push(el);
				el.inject(new Element('li',{'class':this.listType}).inject(this.browser)).store('parent', el.getParent());

				// ->> LOAD the FILE/IMAGE from history when PAGE gets REFRESHED (only directly after refresh)
				this.diag.log('fill on PRESELECT: onShow = ' + this.onShow + ', file = ' + file.name + ', fmFile = ' + fmFile + ', preselect = ' + (preselect ? preselect : '???'));
				if (this.onShow)
				{
					if (preselect)
					{
						if (preselect === file.name)
						{
							this.deselect();
							this.Current = file.element;
							new Fx.Scroll(this.browserScroll,{duration: 'short', offset: {x: 0, y: -(this.browserScroll.getSize().y/4)}}).toElement(file.element);
							file.element.addClass('selected');
							this.diag.log('fill on PRESELECT: fillInfo: file = ' + file.name);
							this.fillInfo(file);
						}
					}
					else if (fmFile)
					{
						if (fmFile === file.name)
						{
							this.deselect();
							this.Current = file.element;
							new Fx.Scroll(this.browserScroll,{duration: 'short', offset: {x: 0, y: -(this.browserScroll.getSize().y/4)}}).toElement(file.element);
							file.element.addClass('selected');
							this.diag.log('fill: fillInfo: file = ' + file.name);
							this.fillInfo(file);
						}
					}
					else
					{
						this.diag.log('fill: RESET onShow: file = ' + file.name);
						this.onShow = false;
					}
				}


// Partikule
// Thumbs list

				// use a closure to keep a reference to the current dg_el, otherwise dg_el, file, etc. will carry the values they got at the end of the loop!
				(function(dg_el, el, file)
				{
					dg_el.store('el_ref', el).addEvents({
						'click': function(e)
						{
							clearTimeout(self.dir_gallery_click_timer);
							self.dir_gallery_click_timer = self.relayDblClick.delay(700, self, [e, this, dg_el, file, 1]);
						},
						'dblclick': function(e)
						{
							clearTimeout(this.dir_gallery_click_timer);
							this.dir_gallery_click_timer = self.relayDblClick.delay(0, self, [e, this, dg_el, file, 2]);
						}
					});

					dg_el.inject(this.dir_filelist);
				}).bind(this)(dg_el, el, file);

// / Partikule
			}
		}

		// check how much we've consumed so far:
		duration = new Date().getTime() - starttime;
		this.diag.log('time taken in array traversal = ' + duration);
		//starttime = new Date().getTime();

		// go to the next stage, right after these messages... ;-)
		this.view_fill_timer = this.fill_chunkwise_2.delay(1, this, [render_count, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir]);
	},

	/*
	 * See comment for fill_chunkwise_1(): the makeDraggable() is a loop in itself and taking some considerable time
	 * as well, so make it happen in a 'fresh' run here...
	 */
	fill_chunkwise_2: function(render_count, pagesize, support_DnD_for_this_dir, starttime, els, kbd_dir) {

		var duration = new Date().getTime() - starttime;
		this.diag.log(' + fill_chunkwise_2() @ ' + duration);

		// check how much we've consumed so far:
		duration = new Date().getTime() - starttime;
		this.diag.log('time taken in array traversal + revert = ' + duration);
		//starttime = new Date().getTime();

		if (support_DnD_for_this_dir) {
			// -> make draggable
			$$(els[0]).makeDraggable({
				droppables: $$(this.droppables.combine(els[1])),
				//stopPropagation: true,

				onDrag: (function(el, e){
					this.imageadd.setStyles({
						'left': e.page.x + 25,
						'top': e.page.y + 25
					});
					//this.imageadd.fade('in');
				}).bind(this),

				onBeforeStart: (function(el){
					this.diag.log('draggable:onBeforeStart');
					var position = el.getPosition();
					el.addClass('drag').setStyles({
						'z-index': this.options.zIndex + 1500,
						'position': 'absolute',
						'width': el.getWidth() - el.getStyle('paddingLeft').toInt() - el.getStyle('paddingRight').toInt(),
						'left': position.x,
						'top': position.y
					}).inject(this.container);
				}).bind(this),

				// FIX: do not deselect item when aborting dragging _another_ item!
				onCancel: (function(el) {
					this.diag.log('draggable:onCancel');
					this.revert_drag_n_drop(el);
					/*
					 * Fixing the 'click' on FF+Opera (other browsers do get that event for any item which is made draggable):
					 * a basic mouse'click' appears as the event sequence onBeforeStart + onCancel.
					 *
					 * NOTE that onStart is NOT invoked! When it is, it's a drag operation, no matter if it's successful as a drag&drop or not.
					 *
					 * So we then manually fire the 'click' event. See also the comment near the 'click' event handler registration in fill_chunkwise_1()
					 * about the different behaviour in different browsers.
					 */
					this.relayClick(null, el);
				}).bind(this),

				onStart: (function(el) {
					this.diag.log('draggable:onStart');
					//this.deselect(el);
					this.tips.hide();

					el.fade(0.7).addClass('move');

					this.diag.log('ENABLE keyboard up/down on drag start');
					//document.addEvents({
					//  keydown: this.bound.keydown,
					//  keyup: this.bound.keyup
					//});

					// FIX wrong visual when CONTROL key is kept depressed between drag&drops: the old code discarded the relevant keyboard handler; we simply switch visuals but keep the keyboard handler active.
					// This state change will be reverted in revert_drag_n_drop().
					this.drag_is_active = true;
					this.imageadd.fade(0 + this.ctrl_key_pressed);
				}).bind(this),

				onEnter: function(el, droppable){
					droppable.addClass('droppable');
				},

				onLeave: function(el, droppable){
					droppable.removeClass('droppable');
				},

				onDrop: (function(el, droppable, e){
					this.diag.log('draggable:onDrop');

					var is_a_move = !(e.control || e.meta);
					this.drop_pending = 1 + is_a_move;

					if (!is_a_move || !droppable) {
						el.setStyles({left: 0, top: 0});
					}

					var dir;
					if (droppable) {
						droppable.addClass('selected').removeClass('droppable');
						(function() {
							droppable.removeClass('selected');
						}).delay(300);
						if (this.onDragComplete(el, droppable)) {
							this.drop_pending = 0;

							this.revert_drag_n_drop(el);   // go and request the details anew, then refresh them in the view
							return;
						}

						dir = droppable.retrieve('file');
						this.diag.log('on drop dir = ' + dir.dir + ' : ' + dir.name + ', source = ' + 'retrieve');
					}

					if ((!this.options.move_or_copy) || (is_a_move && !droppable)) {
						this.drop_pending = 0;

						this.revert_drag_n_drop(el);   // go and request the details anew, then refresh them in the view
						return;
					}

					this.revert_drag_n_drop(el);       // do not send the 'detail' request in here: this.drop_pending takes care of that!

					var file = el.retrieve('file');
					this.diag.log('on drop file = ' + file.name + ' : ' + this.Directory + ', source = ' + 'retrieve; droppable = "' + droppable + '"');

					if (this.Request) this.Request.cancel();

					this.Request = new FileManager.Request({
						url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({},  {
							event: 'move'
						})),
						data: {
							file: file.name,
							filter: this.options.filter,
							directory: this.Directory,
							newDirectory: dir ? (dir.dir ? dir.dir + '/' : '') + dir.name : this.Directory,
							copy: is_a_move ? 0 : 1
						},
						onSuccess: (function(j) {
							if (!j || !j.status) {
								this.drop_pending = 0;
								this.browserLoader.fade(0);
								return;
							}

							this.fireEvent('modify', [Object.clone(file), j, (is_a_move ? 'move' : 'copy'), this]);

							var rerendering_list = false;

							// remove entry from cached JSON directory list and remove the item from the view when this was a move!
							// This is particularly important when working on a paginated directory and afterwards the pages are jumped back & forth:
							// the next time around, this item should NOT appear in the list anymore!
							if (is_a_move)
							{
								this.deselect(file.element);

								if (this.view_fill_json)
								{
									this.delete_from_dircache(file);  /* do NOT use j.name, as that one can be 'cleaned up' as part of the 'move' operation! */

									// minor caveat: when we paginate the directory list, then browsing to the next page will skip one item (which would
									// have been the first on the next page). The brute-force fix for this is to force a re-render of the page when in
									// pagination view mode:
									if (this.view_fill_json.dirs.length + this.view_fill_json.files.length > this.listPaginationLastSize)
									{
										// similar activity as load(), but without the server communication...

										// if (this.Request) this.Request.cancel();

										// abort any still running ('antiquated') fill chunks and reset the store before we set up a new one:
										//this.reset_view_fill_store();
										clearTimeout(this.view_fill_timer);
										this.view_fill_timer = null;

										rerendering_list = true;
										this.fill(null, startindex, this.listPaginationLastSize);
									}
								}

								// make sure fade does not clash with parallel directory (re)load:
								if (!rerendering_list)
								{
									var p = file.element.getParent();
									if (p) {
										p.fade(0).get('tween').chain(function(){
											this.element.destroy();
										});
									}
								}
							}
							else
							{
								if (!dir)
								{
									// copied to the very same directory:
									rerendering_list = true;
									this.load(this.Directory);
								}
							}

							this.drop_pending = 0;
							this.browserLoader.fade(0);
						}).bind(this),
						onError: (function(text, error) {
							this.drop_pending = 0;
							this.browserLoader.fade(0);
						}).bind(this),
						onFailure: (function(xmlHttpRequest) {
							this.drop_pending = 0;
							this.browserLoader.fade(0);
						}).bind(this)
					}, this).send();
				}).bind(this)
			});

			this.browser_dragndrop_info.setStyle('background-position', '0px 0px');
			this.browser_dragndrop_info.set('title', this.language.drag_n_drop);
			//this.browser_dragndrop_info.setStyle('visibility', 'hidden');
		}

		// check how much we've consumed so far:
		duration = new Date().getTime() - starttime;
		this.diag.log(' + time taken in make draggable = ' + duration);
		//starttime = new Date().getTime();

		$$(els[0].combine(els[1])).setStyles({'left': 0, 'top': 0});

		// check how much we've consumed so far:
		duration = new Date().getTime() - starttime;
		this.diag.log(' + time taken in setStyles = ' + duration);

		this.adaptive_update_pagination_size(render_count, render_count, render_count, pagesize, duration, 1.0 / 7.0, 1.02, 0.1 / 1000);

		// go to the next stage, right after these messages... ;-)
		this.view_fill_timer = this.fill_chunkwise_3.delay(1, this, [render_count, pagesize, support_DnD_for_this_dir, starttime, kbd_dir]);
	},

	/*
	 * See comment for fill_chunkwise_1(): the tooltips need to be assigned with each icon (2..3 per list item)
	 * and apparently that takes some considerable time as well for large directories and slightly slower machines.
	 */
	fill_chunkwise_3: function(render_count, pagesize, support_DnD_for_this_dir, starttime, kbd_dir) {

		var duration = new Date().getTime() - starttime;
		this.diag.log(' + fill_chunkwise_3() @ ' + duration);

		this.tips.attach(this.browser.getElements('img.browser-icon'));
		this.browser_dragndrop_info.fade(1);

		// check how much we've consumed so far:
		duration = new Date().getTime() - starttime;
		this.diag.log(' + time taken in tips.attach = ' + duration);

		// when a render is completed, we have maximum knowledge, i.e. maximum prognosis power: shorter tail on the EMA is our translation of that.
		this.adaptive_update_pagination_size(render_count, render_count, render_count, pagesize, duration, 1.0 / 5.0, 1.0, 0);

		// we're done: erase the timer so it can be garbage collected
		clearTimeout(this.view_fill_timer);
		this.view_fill_timer = null;

		// make sure the selection, when keyboard driven, is marked correctly
		if (kbd_dir)
		{
			this.browserSelection(kbd_dir);
		}

		this.browserLoader.fade(0);
	},

	adaptive_update_pagination_size: function(currentindex, endindex, render_count, pagesize, duration, EMA_factor, future_fudge_factor, compensation)
	{
		var avgwait = this.options.listPaginationAvgWaitTime;
		if (avgwait)
		{
			// we can now estimate how much time we'll need to process the entire list:
			var orig_startindex = endindex - render_count;
			var done_so_far = currentindex - orig_startindex;
			// the 1.3 is a heuristic covering for chunk_2+3 activity
			done_so_far /= parseFloat(render_count);
			// at least 5% of the job should be done before we start using our info for estimation/extrapolation
			if (done_so_far > 0.05)
			{
				/*
				 * and it turns out our fudge factors are not telling the whole story: the total number of elements
				 * to render are still a factor then.
				 */
				future_fudge_factor *= (1 + compensation * render_count);

				var t_est = duration * future_fudge_factor / done_so_far;

				// now take the configured _desired_ maximum average wait time and see how we should fare:
				var p_est = render_count * avgwait / t_est;

				// EMA + sensitivity: the closer to our current target, the better our info:
				var tail = EMA_factor * (0.9 + 0.1 * done_so_far);
				var newpsize = tail * p_est + (1 - tail) * pagesize;

				// apply limitations: never reduce more than 50%, never increase more than 20%:
				var delta = newpsize / pagesize;
				if (delta < 0.5)
					newpsize = 0.5 * pagesize;
				else if (delta > 1.2)
					newpsize = 1.2 * pagesize;
				newpsize = newpsize.toInt();

				// and never let it drop below rediculous values:
				if (newpsize < 20)
					newpsize = 20;

				this.diag.log('::auto-tune pagination: new page = ' + newpsize + ' @ tail:' + tail + ', p_est: ' + p_est + ', psize:' + pagesize + ', render:' + render_count + ', done%:' + done_so_far + '(' + (currentindex - orig_startindex) + '), t_est:' + t_est + ', dur:' + duration + ', pdelta: ' + delta);
				this.options.listPaginationSize = newpsize;
			}
		}
	},

	fillInfo: function(file) {

		if (!file) file = this.CurrentDir;
		if (!file) return;

		// set file history
		this.diag.log(this.storeHistory);
		if (typeof jsGET !== 'undefined' && this.storeHistory) {
			if (file.mime !== 'text/directory')
				jsGET.set({'fmFile': file.name});
			else
				jsGET.set({'fmFile': ''});
		}

		var icon = file.icon;

		this.switchButton4Current();

		this.fireHooks('cleanupPreview');
		// We need to remove our custom attributes form when the preview is hidden
		this.fireEvent('hidePreview', [this]);

		this.preview.empty();

		//if (file.mime === 'text/directory') return;

		if (this.drop_pending == 0)
		{
			if (this.Request) this.Request.cancel();

			var dir = this.Directory;

			this.Request = new FileManager.Request({
				url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({},  {
					event: 'detail'
				})),
				data: {
					directory: dir,
					// fixup for *directory* detail requests:
					file: (file.mime === 'text/directory' ? '.' : file.name),
					filter: this.options.filter,
					mode: 'auto'                    // provide either direct links to the thumbnails (when available in cache) or PHP event trigger URLs for delayed thumbnail image creation (performance optimization: faster page render)
				},
				onRequest: (function() {
					this.previewLoader.inject(this.preview);
					this.previewLoader.fade(1);
					this.show_our_info_sections(false);
				}).bind(this),
				onSuccess: (function(j) {

					if (!j || !j.status) {
						this.previewLoader.dispose();
						return;
					}

					// speed up DOM tree manipulation: detach .info from document temporarily:
					this.info.dispose();

					this.info_head.getElement('img').set({
							src: icon,
							alt: file.mime
						});

					this.info_head.getElement('h1').set('text', file.name);
					this.info_head.getElement('h1').set('title', file.name);

					// don't wait for the fade to finish to set up the new content
					var prev = this.preview.removeClass('filemanager-loading').set('html', (j.content ? j.content.substitute(this.language, /\\?\$\{([^{}]+)\}/g) : '')).getElement('img.preview');

					if (file.mime === 'text/directory')
					{
						this.preview.adopt(this.dir_filelist);
					}

					// and plug in the manipulated DOM subtree again:
					this.info.inject(this.filemanager);
					this.show_our_info_sections(true);

					this.previewLoader.fade(0).get('tween').chain((function() {
						this.previewLoader.dispose();
					}).bind(this));

					var els = this.preview.getElements('button');
					if (els) {
						els.addEvent('click', function(e){
							e.stop();
							window.open(this.get('value'));
						});
					}

					if (prev && !j.thumb250 && j.thumbs_deferred)
					{
						var iconpath = this.assetBasePath + 'Images/Icons/Large/default-error.png';

						if (0)
						{
							prev.set('src', iconpath);
							prev.setStyles({
								'width': '',
								'height': '',
								'background': 'none'
							});
						}

						var req = new FileManager.Request({
							url: this.options.url + (this.options.url.indexOf('?') == -1 ? '?' : '&') + Object.toQueryString(Object.merge({},  {
								//event: 'thumbnail'
								event: 'detail'
							})),
							data: {
								directory: dir,
								file: file.name,
								filter: this.options.filter,
								mode: 'direct'
							},
							fmDisplayErrors: false,   // Should we display the error here? No, we just display the general error icon instead
							onRequest: function(){},
							onSuccess: (function(j) {
								var img_url = (j.icon48 ? j.icon48 : iconpath);
								if (j && j.status && j.thumb250)
								{
									img_url = j.thumb250;
								}

								prev.set('src', img_url);
								prev.addEvent('load', function(){
									// when the thumb250 image has loaded, remove the loader animation in the background ...
									//this.setStyle('background', 'none');
									// ... AND blow away the encoded 'width' and 'height' styles: after all, the thumb250 generation MAY have failed.
									// In that case, an icon is produced by the backend, but it will have different dimensions, and we don't want to
									// distort THAT one, either.
									this.setStyles({
										'width': '',
										'height': '',
										'background': 'none'
									});
								});

								// Xinha: We need to add in a form for setting the attributes of images etc,
								// so we add this event and pass it the information we have about the item
								// as returned by Backend/FileManager.php
								this.fireEvent('details', [j, this]);

								// update the stored json for this file as well:

								// now mix with the previously existing 'file' info (as produced by a 'view' run):
								file = Object.merge(file, j);

								// remove unwanted JSON elements:
								delete file.thumbs_deferred;
								delete file.status;
								delete file.error;
								delete file.content;

								if (file.element)
								{
									file.element.store('file', file);
								}

								if (typeof milkbox !== 'undefined')
								{
									milkbox.reloadPageGalleries();
								}
							}).bind(this),
							onError: (function(text, error) {
								prev.set('src', iconpath);
								prev.setStyles({
									'width': '',
									'height': '',
									'background': 'none'
								});
							}).bind(this),
							onFailure: (function(xmlHttpRequest) {
								prev.set('src', iconpath);
								prev.setStyles({
									'width': '',
									'height': '',
									'background': 'none'
								});
							}).bind(this)
						}, this);

						this.RequestQueue.addRequest(String.uniqueID(), req);
						req.send();
					}
					else
					{
						// Xinha: We need to add in a form for setting the attributes of images etc,
						// so we add this event and pass it the information we have about the item
						// as returned by Backend/FileManager.php
						this.fireEvent('details', [j, this]);

						// We also want to hold onto the data so we can access it later on,
						// e.g. when selecting the image.

						// now mix with the previously existing 'file' info (as produced by a 'view' run):
						file = Object.merge(file, j);

						// remove unwanted JSON elements:
						delete file.thumbs_deferred;
						delete file.status;
						delete file.error;
						delete file.content;

						if (file.element)
						{
							file.element.store('file', file);
						}

						if (typeof milkbox !== 'undefined')
						{
							milkbox.reloadPageGalleries();
						}
					}
				}).bind(this),
				onError: (function(text, error) {
					this.previewLoader.dispose();
				}).bind(this),
				onFailure: (function(xmlHttpRequest) {
					this.previewLoader.dispose();
				}).bind(this)
			}, this).send();
		}
	},

	showFunctions: function(icon,appearOn,opacityBefore,opacityAfter) {
		var opacity = [opacityBefore || 1, opacityAfter || 0];
		icon.set({
			opacity: opacity[1]
		});

		$(appearOn).addEvents({
			mouseenter: (function(){
							this.set('opacity', opacity[0]);
						}).bind(icon),
			mouseleave: (function(){
							this.set('opacity', opacity[1]);
						}).bind(icon)
		});
		return icon;
	},

	normalize: function(str){
		return str.replace(/\/+/g, '/');
	},

	switchButton4Current: function() {
		var chk = !!this.Current;
		var els = [];
		els.push(this.menu.getElement('button.filemanager-open'));
		els.push(this.menu.getElement('button.filemanager-download'));
		els.each(function(el){
			if (el)
			{
				el.set('disabled', !chk)[(chk ? 'remove' : 'add') + 'Class']('disabled');
			}
		});
	},

	// adds buttons to the file main menu, which onClick start a method with the same name
	addMenuButton: function(name) {
		var el = new Element('button', {
			'class': 'filemanager-' + name,
			text: this.language[name]
		}).inject(this.menu, 'top');

		if (this[name+'_on_click'])
		{
			el.addEvent('click', this[name+'_on_click'].bind(this));
		}
		return el;
	},

	// clear the view chunk timer, erase the JSON store but do NOT reset the pagination to page 0:
	// we may be reloading and we don't want to destroy the page indicator then!
	reset_view_fill_store: function(j)
	{
		this.view_fill_startindex = 0;   // offset into the view JSON array: which part of the entire view are we currently watching?
		if (this.view_fill_json)
		{
			// make sure the old 'fill' run is aborted ASAP: clear the old files[] array to break
			// the heaviest loop in fill:
			this.view_fill_json.files = [];
			this.view_fill_json.dirs = [];
		}

		this.reset_fill();

		this.view_fill_json = ((j && j.status) ? j : null);      // clear out the old JSON data and set up possibly new data.
		// ^^^ the latest JSON array describing the entire list; used with pagination to hop through huge dirs without repeatedly
		//     consulting the server. The server doesn't need to know we're so slow we need pagination now! ;-)
	},


	// clear the view chunk timer only. We are probably redrawing the list view!
	reset_fill: function()
	{
		//this.browser_dragndrop_info.setStyle('visibility', 'visible');
		this.browser_dragndrop_info.fade(0.5);
		this.browser_dragndrop_info.setStyle('background-position', '0px -16px');
		this.browser_dragndrop_info.set('title', this.language.drag_n_drop_disabled);

		// as this is a long-running process, make sure the hourglass-equivalent is visible for the duration:
		this.browserLoader.fade(1);

		this.browser_paging.fade(0);

		// abort any still running ('antiquated') fill chunks:
		clearTimeout(this.view_fill_timer);
		this.view_fill_timer = null;     // timer reference when fill() is working chunk-by-chunk.
	},

	store_view_fill_startindex: function(idx)
	{
		this.view_fill_startindex = idx;
		if (typeof jsGET !== 'undefined' /* && this.storeHistory */) {
			jsGET.set({'fmPageIdx': idx});
		}
	},

	get_view_fill_startindex: function(idx)
	{
		// we don't care about null, undefined or 0 here: as we keep close track of the startindex, any nonzero valued setting wins out.
		if (!idx)
		{
			idx = this.view_fill_startindex;
		}
		if (typeof jsGET !== 'undefined' && !idx)
		{
			idx = jsGET.get('fmPageIdx');
		}
		return parseInt(idx ? idx : 0, 10);
	},

	fireHooks: function(hook){
		var args = Array.slice(arguments, 1);
		for(var key in this.hooks[hook]) {
			this.hooks[hook][key].apply(this, args);
		}
		return this;
	},

	cvtXHRerror2msg: function(xmlHttpRequest) {
		var status = xmlHttpRequest.status;
		var orsc = xmlHttpRequest.onreadystatechange;
		var response = (xmlHttpRequest.responseText || this.language['backend.unidentified_error']);

		var text = response.substitute(this.language, /\\?\$\{([^{}]+)\}/g);
		return text;
	},

	showError: function(text) {
		var errorText = '' + text;

		if (!errorText) {
			errorText = this.language['backend.unidentified_error'];
		}
		errorText = errorText.substitute(this.language, /\\?\$\{([^{}]+)\}/g);

		if (this.pending_error_dialog)
		{
			this.pending_error_dialog.appendMessage(errorText);
		}
		else
		{
			this.pending_error_dialog = new FileManager.Dialog(this.language.error, {
				buttons: ['confirm'],
				language: {
					confirm: this.language.ok
				},
				content: [
					errorText
				],
				zIndex: this.options.zIndex + 1000,
				onOpen: this.onDialogOpen.bind(this),
				onClose: function()
				{
					this.pending_error_dialog = null;
					this.onDialogClose();
				}.bind(this)
			});
		}
	},

	showMessage: function(textOrElement, title) {
		if (!title) title = '';
		new FileManager.Dialog(title, {
			buttons: ['confirm'],
			language: {
				confirm: this.language.ok
			},
			content: [
				textOrElement
			],
			zIndex: this.options.zIndex + 950,
			onOpen: this.onDialogOpen.bind(this),
			onClose: this.onDialogClose.bind(this)
		});
	},

	onRequest: function(){
		this.loader.fade(1);
	},
	onComplete: function(){
		//this.loader.fade(0);
	},
	onSuccess: function(){
		this.loader.fade(0);
	},
	onError: function(){
		this.loader.fade(0);
	},
	onFailure: function(){
		this.loader.fade(0);
	},
	onDialogOpen: function(){
		this.dialogOpen = true;
		this.onDialogOpenWhenUpload.apply(this);
	},
	onDialogClose: function(){
		this.dialogOpen = false;
		this.onDialogCloseWhenUpload.apply(this);
	},
	onDialogOpenWhenUpload: function(){},
	onDialogCloseWhenUpload: function(){},
	onDragComplete: function(){
		return false;   // return TRUE when the drop action is unwanted
	},

	// dev/diag shortcuts:

	// always return a string; dump object/array/... in 'arr' to human readable string:
	diag:
	{
		verbose: false,
		dump: function(arr, level, max_depth, max_lines, no_show)
		{
			return '';
		},
		log: function(/* ... */)
		{
			if (!this.verbose) return;

			if (typeof console !== 'undefined')
			{
				if (console.info)
				{
					console.info.apply(console, arguments);
				}
				else if (console.log)
				{
					console.log.apply(console, arguments);
				}
			}
		}
	}
});

FileManager.Request = new Class({
	Extends: Request.JSON,

	options:
	{
		secure:          true, // Isn't this true by default anyway in REQUEST.JSON?
		fmDisplayErrors: true  // Automatically display errors - ** your onSuccess still gets called, just ignore if it's an error **
	},

	initialize: function(options, filebrowser){
		this.parent(options);

		this.options.data = Object.merge({}, filebrowser.options.propagateData, this.options.data);

		if (this.options.fmDisplayErrors)
		{
			this.addEvents({
				success: function(j)
				{
					if (!j)
					{
						filebrowser.showError();
					}
					else if (!j.status)
					{
						filebrowser.showError(('' + j.error).substitute(filebrowser.language, /\\?\$\{([^{}]+)\}/g));
					}
				}.bind(this),

				error: function(text, error)
				{
					filebrowser.showError(text);
				},

				failure: function(xmlHttpRequest)
				{
					var text = filebrowser.cvtXHRerror2msg(xmlHttpRequest);
					filebrowser.showError(text);
				}
			});
		}

		this.addEvents({
			request: filebrowser.onRequest.bind(filebrowser),
			complete: filebrowser.onComplete.bind(filebrowser),
			success: filebrowser.onSuccess.bind(filebrowser),
			error: filebrowser.onError.bind(filebrowser),
			failure: filebrowser.onFailure.bind(filebrowser)
		});
	}
});

FileManager.Language = {};

(function(){

// ->> load DEPENDENCIES
if (typeof __MFM_ASSETS_DIR__ === 'undefined')
{
	var __DIR__ = (function() {
			var scripts = document.getElementsByTagName('script');
			var script = scripts[scripts.length - 1].src;
			var host = window.location.href.replace(window.location.pathname+window.location.hash,'');
			return script.substring(0, script.lastIndexOf('/')).replace(host,'') + '/';
	})();
	__MFM_ASSETS_DIR__ = __DIR__ + "../Assets";
}
Asset.javascript(__MFM_ASSETS_DIR__+'/js/milkbox/milkbox.js');
Asset.css(__MFM_ASSETS_DIR__+'/js/milkbox/css/milkbox.css');
Asset.css(__MFM_ASSETS_DIR__+'/Css/FileManager.css');
Asset.css(__MFM_ASSETS_DIR__+'/Css/Additions.css');
Asset.javascript(__MFM_ASSETS_DIR__+'/js/jsGET.js', {
	events: {
		load: (function(){
			window.fireEvent('jsGETloaded');
		}).bind(this)
	}
});

Element.implement({

	center: function(offsets) {
		var scroll = document.getScroll();
		var	offset = document.getSize();
		var	size = this.getSize();
		var	values = {x: 'left', y: 'top'};

		if (!offsets) {
			offsets = {};
		}

		for (var z in values) {
			var style = scroll[z] + (offset[z] - size[z]) / 2 + (offsets[z] || 0);
			this.setStyle(values[z], (z === 'y' && style < 30) ? 30 : style);
		}
		return this;
	}

});

FileManager.Dialog = new Class({

	Implements: [Options, Events],

	options: {
		/*
		 * onShow: function(){},
		 * onOpen: function(){},
		 * onConfirm: function(){},
		 * onDecline: function(){},
		 * onClose: function(){},
		 */
		request: null,
		buttons: ['confirm', 'decline'],
		language: {},
		zIndex: 2000
	},

	initialize: function(text, options){
		this.setOptions(options);
		this.dialogOpen = false;

		this.content_el = new Element('div', {
			'class': 'filemanager-dialog-content'
		}).adopt([
			typeOf(text) === 'string' ? this.str2el(text) : text
		]);

		this.el = new Element('div', {
			'class': 'filemanager-dialog' + (Browser.ie ? ' filemanager-dialog-engine-trident' : '') + (Browser.ie ? ' filemanager-dialog-engine-trident' : '') + (Browser.ie8 ? '4' : '') + (Browser.ie9 ? '5' : ''),
			opacity: 0,
			tween: {duration: 'short'},
			styles:
			{
				'z-index': this.options.zIndex
			}
		}).adopt(this.content_el);

		if (typeof this.options.content !== 'undefined') {
			this.options.content.each((function(content){
				if (content)
				{
					if (typeOf(content) !== 'string')
					{
						this.content_el.adopt(content);
					}
					else
					{
						this.content_el.adopt(this.str2el(content));
					}
				}
			}).bind(this));
		}

		Array.each(this.options.buttons, function(v){
			new Element('button', {'class': 'filemanager-dialog-' + v, text: this.options.language[v]}).addEvent('click', (function(e){
				if (e) e.stop();
				this.fireEvent(v).fireEvent('close');
				//if (!this.options.hideOverlay)
				this.overlay.hide();
				this.destroy();
			}).bind(this)).inject(this.el);
		}, this);

		this.overlay = new Overlay({
			'class': 'filemanager-overlay filemanager-overlay-dialog',
			events: {
				click: this.fireEvent.pass('close',this)
			},
			//tween: {duration: 'short'},
			styles:
			{
				'z-index': this.options.zIndex - 1
			}
		});

		this.bound = {
			scroll: (function(){
				if (!this.el)
					this.destroy();
				else
					this.el.center();
			}).bind(this),

			keyesc: (function(e){
				window.FileManager.prototype.diag.log('keyEsc: key press: ', e);
				if (e.key === 'esc') {
					e.stopPropagation();
					this.destroy();
				}
			}).bind(this)
		};

		this.show();
	},

	show: function(){
		this.overlay.show();

		var self = this;
		this.fireEvent('open');
		this.el.setStyle('display', 'block').inject(document.body);
		this.restrictSize();
		this.el.center().fade(1);
		var button = (this.el.getElement('button.filemanager-dialog-confirm') || this.el.getElement('button'));
		if (button) {
			button.focus();
		}
		self.fireEvent('show');

		window.FileManager.prototype.diag.log('add key up(ESC)/resize/scroll on show 1500');
		document.addEvents({
			'scroll': this.bound.scroll,
			'resize': this.bound.scroll,
			'keyup': this.bound.keyesc
		});
	},

	appendMessage: function(text) {
		this.content_el.adopt([
			typeOf(text) === 'string' ? this.str2el(text) : text
		]);
		this.restrictSize();
		this.el.center();
	},

	restrictSize: function()
	{
		// make sure the dialog never is larger than the viewport!
		var ddim = this.el.getSize();
		var vdim = window.getSize();
		var maxx = (vdim.x - 20) * 0.85; // heuristic: make dialog a little smaller than the screen itself and keep a place for possible outer scrollbars
		if (ddim.x >= maxx)
		{
			this.el.setStyle('width', maxx.toInt());
		}
		ddim = this.el.getSize();
		var cdim = this.content_el.getSize();
		var maxy = (vdim.y - 20) * 0.85; // heuristic: make dialog a little less high than the screen itself and keep a place for possible outer scrollbars
		if (ddim.y >= maxy)
		{
			// first attempt to correct this by making the dialog wider:
			var x = ddim.x * 2.0;
			while (x < maxx && ddim.y >= maxy)
			{
				this.el.setStyle('width', x.toInt());
				ddim = this.el.getSize();
				x = ddim.x * 1.3;
			}

			cdim = this.content_el.getSize();
			if (ddim.y >= maxy)
			{
				var y = maxy - ddim.y + cdim.y;
				this.content_el.setStyles({
					height: y.toInt(),
					overflow: 'auto'
				});
			}
		}
	},

	str2el: function(text)
	{
		var el = new Element('div');
		if (text.indexOf('<') != -1 && text.indexOf('>') != -1)
		{
			try
			{
				el.set('html', text);
			}
			catch(e)
			{
				el.set('text', text);
			}
		}
		else
		{
			el.set('text', text);
		}
		return el;
	},

	destroy: function() {
		if (this.el) {
			this.el.fade(0).get('tween').chain((function(){
				if (!this.options.hideOverlay) {
					this.overlay.destroy();
				}
				this.el.destroy();
			}).bind(this));
		}
		window.FileManager.prototype.diag.log('remove key up(ESC) on destroy');
		document.removeEvent('scroll', this.bound.scroll).removeEvent('resize', this.bound.scroll).removeEvent('keyup', this.bound.keyesc);
		this.fireEvent('close');
	}
});

this.Overlay = new Class({

	initialize: function(options){
		this.el = new Element('div', Object.append({
			'class': 'filemanager-overlay'
		}, options)).inject(document.body);
	},

	show: function(){
		this.objects = $$('object, select, embed').filter(function(el){
			if (el.id === 'SwiffFileManagerUpload' || el.style.visibility === 'hidden') {
				return false;
			}
			else {
				el.style.visibility = 'hidden';
				return true;
			}
		});

		this.resize();

		this.el.setStyles({
			opacity: 0,
			display: 'block'
		}).get('tween'). /* pause(). */ start('opacity', 0.5);

		window.addEvent('resize', this.resize.bind(this));

		return this;
	},

	hide: function(){
		if (!Browser.ie) {
			this.el.fade(0).get('tween').chain((function(){
				this.revertObjects();
				this.el.setStyle('display', 'none');
			}).bind(this));
		} else {
			this.revertObjects();
			this.el.setStyle('display', 'none');
		}

		window.removeEvent('resize', this.resize);

		return this;
	},

	resize: function(){
		if (!this.el) {
			this.destroy();
		}
		else {
			this.el.setStyles({
				width: document.getScrollWidth(),
				height: document.getScrollHeight()
			});
		}
	},

	destroy: function(){
		this.revertObjects().el.destroy();
	},

	revertObjects: function(){
		if (this.objects && this.objects.length) {
			this.objects.each(function(el){
				el.style.visibility = 'visible';
			});
		}

		return this;
	}
});

})();
