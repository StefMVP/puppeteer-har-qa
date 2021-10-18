const puppeteer = require('puppeteer');
const PuppeteerHar = require('puppeteer-har');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const beautify = require('js-beautify').js

//Set via config
let url = "";
let userName = '';
let password = '';
let shouldCloseBrowser = true;
let isHeadless = false;
let windowSize = '1920,1080';
let devToolsEnabled = false;
let slowMoVal = 10;
let shouldBeautify = false;
let mainFileInclude = '/main'
let downloadMainfilePath = 'download/download-main.js'
let numberLinesToPrintBefore = 15;
let numberLinesToPrintAfter = 0;
let numberTraceLines = 3;

//Global variable
let mainUrlHash = '';
const beautifiedFilePromises = [];
let consoleErrors = []
let networkErrors = []

function convertURLToFileName(url) {
    return crypto.createHash('md5').update(url).digest("hex");
  }

async function GetBrowser(){
    return await puppeteer.launch({ 
        headless: isHeadless,
        devtools: devToolsEnabled,
        defaultViewport: null,  
        args: [
            '--ignore-certificate-errors',
            '--window-size='+windowSize,
        ],
        slowMo: slowMoVal,
    });
}

async function SetupPageEvents(page) {
    page.on('console', async (msg) => {
        if (msg._type == 'error'){
            console.log(msg)
            const args = await msg.args()
            args.forEach(async (arg) => {
                const val = await arg.jsonValue()
                if (JSON.stringify(val) === JSON.stringify({})){
                    const { type, subtype, description } = arg._remoteObject
                    consoleErrors.push(description);
                }
            })
        }
    });
    page.on('response', async resp => {
        if (resp._status.toString().startsWith('4') || resp._status.toString().startsWith('5')){
            let respText = ''
            try{
                respText = await resp.json();
            }
            catch{}
            let respTextSplit = respText != '' ? respText.trace.split('\n') : []
            let respTextFinal = ''
            let maxTraceLength = Math.min(respTextSplit.length, numberTraceLines)
            for (let i = 0; i < maxTraceLength; i++){
                respTextFinal += '\n' + respTextSplit[i]
            }
            networkErrors.push([respText.error, resp._status, resp._url, respText.message, respTextFinal]); 
        }
        if (resp.url().includes(mainFileInclude) && resp.url().includes('.js')) {
            mainUrlHash = convertURLToFileName(await resp._url)
        }
    });
    page.on('requestfinished', async (interceptedRequest) => {
        const fileName = convertURLToFileName(interceptedRequest.url());
        if(interceptedRequest.resourceType() === 'script' && fileName == mainUrlHash) {

            beautifiedFilePromises.push(new Promise(async (resolve) => {
                let redirectChain = interceptedRequest.redirectChain();
                if(redirectChain.length === 0) {
                let response = await interceptedRequest.response();
                //console.log(interceptedRequest.url(), fileName, mainUrlHash)

                if (response !== null) {
                    let contentRequest = await response.text();

                    if (shouldBeautify){
                        const scriptBeautified = beautify(contentRequest, { 
                            indent_size: 2, 
                            space_in_empty_paren: true 
                            });
                        fs.writeFile(downloadMainfilePath, scriptBeautified, 'utf8', (err) => {
                            if (err !== null) {
                                console.error(`Could not save the beautified file: ${err.message}`);
                            }
                            resolve();
                        });
                    }
                    else{
                        fs.writeFile(downloadMainfilePath, contentRequest, 'utf8', (err) => {
                            if (err !== null) {
                                console.error(`Could not save the beautified file: ${err.message}`);
                            }
                            resolve();
                        });
                    }
                }}
                resolve();
            })); 
        }
    });
}

async function Login(page){
    //await page.waitForNavigation()
    await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#username')
    await page.type('#username', userName)

    await page.waitForSelector('#password')
    await page.type('#password', password)

    await page.waitForSelector('#loginButton')
    await page.click('#loginButton')

    await page.waitForNavigation({
        waitUntil: 'networkidle0',
    });
    await page.waitForSelector('#pageContent');
}

async function ClickXPath(xPath){
    const elements = await page.$x(xPath)
    if (elements.length > 0){
        await elements[0].click()
    }
    else{
        console.error(xpath + " not found.")
    }
}

async function ParseConsoleErrors(){
    consoleErrors = [...new Set(consoleErrors)];
    for (let i = 0; i < consoleErrors.length; i++){
        try{
            let description;
            let lineNumber
            let consoleErrorsSplit = consoleErrors[i].split('\n    ');
            if (consoleErrorsSplit.length > 1){
                description = consoleErrorsSplit[0]
                lineNumber = parseInt(consoleErrorsSplit[1].split(':').reverse()[1])
                if (consoleErrors[i].includes(mainFileInclude)){
                    let source = SearchSource(lineNumber);

                    console.log('\n')
                    console.log('------------------------------------------------------------------------')
                    console.log('Console Error #' + parseInt(i+1) + ': ' + description)
                    console.log('------------------------------------------------------------------------')
                    for (let i = 0; i < source.length; i++){
                        if (source[i][0] == lineNumber-1){
                            console.log('\u001b[31m' + source[i] + '\u001b[31m');
                        }
                        else{
                            console.log(''+source[i]);
                        }
                    }
                }
            }
        }
        catch(e){
            console.log(e,consoleErrors[i])
        }
    }
}

function ParseNetworkErrors(){
    networkErrors = [...new Set(networkErrors)];
    for (let i = 0; i < networkErrors.length; i++) {
        console.log('------------------------------------------------------------------------')
        console.log('Network Error #' + parseInt(i+1) + ': ' + networkErrors[i])
        console.log('------------------------------------------------------------------------')
    }
}

function SearchSource(lineNumber){
    let finalreturn = []
    try{
        const data = fs.readFileSync(downloadMainfilePath, 'utf8')
        var array = data.toString().split("\n");
        for (let i = lineNumber-numberLinesToPrintBefore-1; i < lineNumber+numberLinesToPrintAfter; i++){
            finalreturn.push([i, array[i]])
        }
    }
    catch(e){
        console.error(e);
    }

    return finalreturn;
}

(async () => {
    const browser = await GetBrowser();
    const page = await browser.newPage();

    await SetupPageEvents(page);

    const har = new PuppeteerHar(page);
    await har.start({ path: 'download/result.har' });

    await page.goto(url);
    await page.waitForNavigation({
        waitUntil: 'networkidle0',
    });
    
    await Login(page);

    await Promise.all(beautifiedFilePromises);

    await ParseConsoleErrors();
    await ParseNetworkErrors();

    await har.stop();
    await page.screenshot({ path: 'download/result.png' });

    if (shouldCloseBrowser){
        await browser.close();
    }
})();