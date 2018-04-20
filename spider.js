const request = require('request');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const http = require('http');
const fs = require('fs');
const stream = require('./stream');
const config = require('./config');
const arealookup = require('./arealookup');
const xlsx = require('node-xlsx').default;

var resultSourceList = new Array();
var resultUrlList = new Array(); 

function is_Unique(url){
	for(let i =0 ; i < resultUrlList.length; i++){
		if(resultUrlList[i] == url){
			return false;
		}
	}
	return true;
}
function is_Unique_source(source){
	for(let i =0 ; i < resultSourceList.length; i++){
		if(resultSourceList[i] == source){
			return false;
		}
	}
	return true;
}
function sourceValid(source){
	var sIv = config.sourceInvalid;
	for(let i = 0 ; i < sIv.length; i++){
		if(source == sIv[i])
			return false;
	}
	return true;
}
function checkFin(qname){
	if(stream._streams[qname]['new'].length == 0 && stream._streams[qname]['curConcurrency']== 0 ){
		fs.writeFileSync('result.json',JSON.stringify(resultContentList));
		fs.writeFileSync('resultSource.json',JSON.stringify(resultSourceList));
		const data = [['序号','标题','发布时间', '工作地点','职位类型','来源','招聘岗位信息']];
		for(let i=0;i<resultContentList.length;i++){
			var order = i+1;
			var title = resultContentList[i].title;
			var rtime = resultContentList[i].ReleaseTime.split('：')[1];
			var wspot = resultContentList[i].WorkSpot.split('：')[1];
			var position = resultContentList[i].Position.split('：')[1];
			var source = resultContentList[i].Source.split('：')[1];
			var body = resultContentList[i].body;
			data.push([order,title,rtime,wspot,position,source,body]); 
		}
		var buffer = xlsx.build([{name: "mySheetName", data: data}]); // Returns a buffer
		fs.writeFileSync('test1.xlsx',buffer,{'flag':'w'});
		console.log('Writing result!');
	}	
}
function parseDiv(div){
	var strarr = div.split('\n');
	var title = strarr[0];
	var reg = /^[ \t]+$/;
	var body = '';
	console.log(`length = ${strarr.length}`);
	if(strarr.length==1){
		var sindex = div.indexOf('站内');
		return {
			title: title,
			body: div.slice(sindex+2)
		}
	}
	else{
		for(let i = 1; i < strarr.length; i ++){
			if(!strarr[i].match(reg))
				body +=	strarr[i].trim() +'\n';
		}
		return {
			'title': title,
			'body': body
		};
	}
}
stream.create('listQueue',(item)=>{
	var params = {
		"word": item.keyword,
		"area": item.area,
		"jobterm" : item.jobterm,
		"sort" : "score",
		"start": (item.page-1)*10
	};
	var rurl = "http://s.yingjiesheng.com/search.php";
	var options = {
		url: rurl,
		qs: params
	};
	request(options,(error,response,body)=>{
		if(!error&& response.statusCode == 200){
			var $ = cheerio.load(body);
			var searchResults = $('ul.searchResult').children();
			//console.log(`handling for the ${item.keyword} page ${item.page}`);
			//console.log($('a',searchResults[9]).attr('href'));
			//console.log($('p',searchResults[9]).text());
			for(let i = 0 ; i  <10 ; i++){
				var url = $('a',searchResults[i]).attr('href');
				var source = ($('p',searchResults[i]).text()).split("\n")[1].slice(6).split('|')[0];
				if(is_Unique(url)&&sourceValid(source)){
					resultUrlList.push(url);
					stream.insert('contentQueue',url);
				}
				if(is_Unique_source(source)){
					resultSourceList.push(source);
				}
			}
			 stream.finished('listQueue');
		}
		else{
			stream.finished('listQueue');
		}
	});
});
var finishedNum = 0;
var resultContentList = new Array();

stream.create('contentQueue',(item)=>{
	var url = item;
	http.get(url, function(res){
		var arrBuf = [];
		var bufLength = 0;
		res.on("data", function(chunk){
			arrBuf.push(chunk);
			bufLength += chunk.length;
		})
		.on("end", function(){
			var chunkAll = Buffer.concat(arrBuf, bufLength);
			var strJson = iconv.decode(chunkAll,'gb2312'); // 汉字不乱码
			$ = cheerio.load(strJson);
			var resultPreFix = $('div.clearfix').text();
			var otitle = $('h1').text(); 
			var prefix = $('div.clearfix');
			var lis = $('ol',prefix).children();
			var resultWordDiv = $('div.jobContent').text().trim();
			var tmpItem = new Object();
			tmpItem['Url'] = url;
			tmpItem['Prefix'] = resultPreFix;
			var prefix = $('div.clearfix');
			var lis = $('ol',prefix).children();
			tmpItem['ReleaseTime'] = $(lis[0]).text();
			tmpItem['WorkSpot'] = $(lis[1]).text();
			tmpItem['WorkType'] = $(lis[2]).text();
			tmpItem['Source'] = $(lis[3]).text();
			tmpItem['Position'] = $(lis[4]).text();
			//console.log(`get here position = ${$(lis[4]).text()}`)
			var parsedDiv = parseDiv(resultWordDiv);
			if(parsedDiv.body.length <parsedDiv.title.length){
				tmpItem['title'] = otitle;
				tmpItem['body'] = parsedDiv.title;
			}
			else{
				tmpItem['title'] = parsedDiv.title;
				tmpItem['body'] = parsedDiv.body;
			}
			resultContentList.push(tmpItem);
			finishedNum++;
			stream.finished("contentQueue");
			console.log(`NOW ${finishedNum} finished!! contentQueue length = ${stream._streams['contentQueue']['new'].length} Maxcnc = ${stream._streams['contentQueue']['maxConcurrency']} Curcnc = ${stream._streams['contentQueue']['curConcurrency']} interval = ${stream._streams['contentQueue']['interval']} `); 
			checkFin("contentQueue");
		})
	});
});

//stream.insert('contentQueue','http://www.yingjiesheng.com/job-003-216-461.html');

config.keywords.forEach((item,indx)=>{
	for(let i = 1 ; i <= config.PageNum; i ++ ){
		var tmpItem = new Object();
		tmpItem.keyword = item;
		tmpItem.area = arealookup[config.area];
		tmpItem.jobterm = config.jobterm;
		tmpItem.page = i;
		stream.insert('listQueue',tmpItem);
	}
});

// var interval = setInterval(()=>{
// 	console.log("fucked!!!!!");
// 	if(stream._streams['contentQueue']['new'].length == 0 && stream._streams['contentQueue']['curConcurrency']== 0 ){
// 		fs.writeFileSync('result.json',JSON.stringify(resultContentList));
// 		fs.writeFileSync('resultSource.json',JSON.stringify(resultSourceList));
// 		console.log('Writing result!');
// 		clearInterval(interval);
// 	}	
// },1000);

// var params = {
//     "word": "券商",
//     "area": "1056",
//     "jobterm" : "1",
//     "do": "1"
// 	};
// var rurl = "http://s.yingjiesheng.com/search.php";
// var options = {
// 	url: rurl,
// 	qs: params
// };
			
// request(options,(error,response,body)=>{
// 	if(!error&& response.statusCode == 200){
// 		var $ = cheerio.load(body);
// 		var searchResults = $('ul.searchResult').children();
// 		console.log($('a',searchResults[4]).attr('href'));
// 		console.log($('p',searchResults[4]).text());
// 		 // searchResults.each((i,elem)=>{
// 		 // 	var li = $(this);
// 			// console.log(li.find('h3').html());
// 		 // });
// 	}
// });
// var url = 'http://www.yingjiesheng.com/job-003-441-455.html';


// http.get(url, function(res){
// var arrBuf = [];
// var bufLength = 0;
// res.on("data", function(chunk){
// 	arrBuf.push(chunk);
// 	bufLength += chunk.length;
// 	})
// 	.on("end", function(){
// 	var chunkAll = Buffer.concat(arrBuf, bufLength);
// 	var strJson = iconv.decode(chunkAll,'gb2312'); // 汉字不乱码
// 		$ = cheerio.load(strJson);
// 		var resultPreFix = $('div.clearfix').text();
// 		var prefix = $('div.clearfix');
// 		var lis = $('ol',prefix).children();
// 		console.log($(lis[2]).text());
// 		var resultWordDiv = $('div.jobContent').text().trim();
// 		//console.log(resultPreFix);
// 		//console.log(resultWordDiv);
// })
// });
