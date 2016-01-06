var fs = require('fs'),
	expand = require('glob-expand'),
	cheerio = require('cheerio'),
	striptags = require('striptags'),
	crypto = require('crypto');


var contentDirDefault = './resource/content/';


module.exports = function createContent(contentDir) {
	var rxDefault = /^default/i, rxHtml = /\.html?$/i,
		rxMyDeps = /^mydeps/i, rxTsMap = /\.(?:(ts)|(map))$/i,
		helper = (function() {
			var oldJsonArticles = [];
			try {
				oldJsonArticles = JSON.parse(fs.readFileSync(
					contentDir + 'content.json').toString()).metaArticles;
			} catch (e) {}
			
			return {
				hashExists: function(hash) {
					return oldJsonArticles.filter(function(metaArt) {
						return metaArt.hash === hash;
					}).length > 0;
				},
				
				lastLastMod: function(hash) {
					return oldJsonArticles.filter(function(metaArt) {
						return metaArt.hash === hash;
					})[0].lastMod;
				}
			};
		})();
	
	contentDir = contentDir || contentDirDefault; // fall-back
	
	var getAutoLastMod = function(path) {
		return new Date(Date.parse(fs.statSync(path).mtime)).toISOString();
	};
	
	var processFile = function(file) {
		var info = {
			path: 'content/' + file, // create relative path for the JSON
			type: null
		};
		
		// Check if is a user-dependency (mydeps)
		if (file.startsWith('mydeps')) {
			info.type = 'mydeps';
			return processDependency(info);
		}
		
		var content = fs.readFileSync(contentDir + file).toString(),
			$ = cheerio.load(content);
		
		if ($('article').length > 0) {
			// is article:
			info.type = 'article';
			return processArticle(file, content, info);
		} else if ($('fragment').length > 0) {
			// is fragment:
			info.type = 'fragment';
			return processFragment(file, content, info);
		} else {
			throw 'Cannot process content-file: ' + file;
		}
	};
	
	/**
	 * This is used to return a dependency where we try to match
	 * a type.
	 * @see: https://oclazyload.readme.io/docs/oclazyload-service
	 */
	var processDependency = function(info) {
		var supportedOcLazyLoadTypes = /(css|html|js)$/i,
			exec = supportedOcLazyLoadTypes.exec(info.path);
		
		if (exec) {
			info.path = { type: exec[1].toLowerCase(), path: info.path };
		} else {
			info.path = info.path;
		}
		
		return info;
	};
	
	/**
	 * Processes the meta-information of an article.
	 */
	var processArticle = function(file, content, info) {
		var $ = cheerio.load(content);
		
		info.lastMod = null;
		info.urlName = null;
		info.teaser = null;
		info.title = null;
		info.hash = crypto.createHash('sha1').update(content).digest('hex');
		
		$('meta').toArray().forEach(function(htmlMeta) {
			var metaName = $(htmlMeta).attr('name').toLowerCase(),
				metaContent = $(htmlMeta).attr('content');
			
			if (/last-?modified/i.test(metaName)) {
				if (metaContent === 'auto') {
					// Now we have to check if an update of the lastmod is
					// required by comparing to a hash:
					if (helper.hashExists(info.hash)) {
						// then we'll have to keep the existing lastMod-date
						info.lastMod = helper.lastLastMod(info.hash);
					} else {
						info.lastMod = getAutoLastMod('./resource/' + info.path);
					}
				} else {
					info.lastMod = new Date(Date.parse(metaContent)).toISOString()
				}
			} else if (metaName === 'urlname') {
				info.urlName = metaContent;
			} else if (metaName === 'title') {
				info.title = metaContent;
			} else if (metaName === 'draft') {
				info.draft = true;
			} else {
				info[metaName] = metaContent;
			}
		});
		
		info.teaser = striptags($('article').html()).replace(/\s+/g, ' ').trim();
		if (info.teaser.length > 150) {
			info.teaser = info.teaser.substr(0, 150);
			var idx = info.teaser.lastIndexOf('.');
			if (idx > 0) {
				info.teaser = info.teaser.substr(0, idx) + '.';
			}
		}

		// now check for lastmod, urlname and title:
		if (!info.lastMod) {
			info.lastMod = getAutoLastMod('./resource/' + info.path);
		}
		if (!info.urlName) {
			info.urlName = file;
		}
		if (!info.title) {
			info.title = file;
		}
		
		return info;
	};
	
	/**
	 * Reads one fragment and processes its meta-content.
	 */
	var processFragment = function(file, content, info) {
		var $ = cheerio.load(content);
		
		info.id = null;
		info.content = null;
		info.mime = null;
		
		// If we find a fragment-tag with name "embed" (regardless of its value),
		// we will set the path to null and the content to the fragment's content.
		$('meta').toArray().forEach(function(frgMeta) {
			var frgName = $(frgMeta).attr('name').toLowerCase(),
				frgContent = $(frgMeta).attr('content') || '';
			
			if (frgName === 'embed') {
				info.path = null;
				info.content = '<fragment>' + $('fragment').html() + '</fragment>';
			} else {
				info[frgName] = frgContent;
			}
		});
			
		if (!info.id) {
			throw 'Each fragment must have a unique ID.';
		}
		
		return info;
	};
	
	var files = expand({
		filter: 'isFile',
		cwd: contentDir
	}, '**/*').filter(function(file) {
		var ignore = [
			'content.json',
			'default.html',
			'default-md.html',
			'default-md.md',
			'default-md.template.jst',
			'defaultFragment.html',
			'defaultFragment-md.html',
			'defaultFragment-md.md',
			'defaultFragment-md.template.jst'
		];
		
		return ignore.indexOf(file) === -1 &&
			!rxDefault.test(file) &&
			!rxTsMap.test(file) &&
			(rxHtml.test(file) || rxMyDeps.test(file));
	}).map(processFile).filter(function(file) {
		// This change allows us to attach a draft-property to any kind
		// of article, fragment or dependency. 
		return !file.hasOwnProperty('draft');
	});
	
	var rmProps = function(obj) {
		delete obj['type'];
		delete obj['last-modified']; // we will have 'lastMod'
		return obj;
	};
	
	fs.writeFileSync(contentDir + 'content.json', JSON.stringify({
		mydeps: files.filter(function(file) { return file.type === 'mydeps'; }).map(rmProps),
		metaArticles: files.filter(function(file) { return file.type === 'article'; }).map(rmProps),
		metaFragments: files.filter(function(file) { return file.type === 'fragment'; }).map(rmProps)
	}), { encoding: 'utf-8' });
};
