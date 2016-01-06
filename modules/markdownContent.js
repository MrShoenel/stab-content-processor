var fs = require('fs'),
	cheerio = require('cheerio'),
	expand = require('glob-expand'),
	marked = require('marked');


var postCompile = function(src) {
	var $ = cheerio.load(src),
		metas = $('div#meta meta').toArray().map(function(m) {
			return $.html(m);
		}).join('\n');

	$('div#meta').remove();
	return metas + '\n\n<article>\n' + $.html().trim() + '\n</article>';
};


var contentDirDefault = './resource/content/';
var templateFileDefault = 'default-md.template.jst';



module.exports = function markdown2Html(contentDir, templateFile) {
	contentDir = contentDir || contentDirDefault;
	templateFile = templateFile || contentDir + templateFileDefault;
	
	var template = fs.readFileSync(templateFile).toString() || '<%=content%>';

	var files = expand({
		cwd: contentDir,
		filter: 'isFile'
	}, ['**/*.md', '!default*md']);
	
	files.forEach(function(file) {
		var content = postCompile(
			template.replace('<%=content%>', marked(fs.readFileSync(contentDir + file).toString())));
		fs.writeFileSync((contentDir + file).replace(/\.md$/, '.html'),
			content, { encoding: 'utf-8' });
	});
};
