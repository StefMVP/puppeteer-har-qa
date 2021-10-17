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
let isHeadless = false;
let windowSize = '1920,1080';
let devToolsEnabled = false;
let slowMoVal = 0;

//Global variable
let mainUrlHash = '';
const beautifiedFilePromises = [];

function convertURLToFileName(url) {
    return crypto.createHash('md5').update(url).digest("hex");
  }

async function GetBrowser(){
    return await puppeteer.launch({ 
        headless: isHeadless,
        devtools: devToolsEnabled,
        defaultViewport: null,  
        args: [
            '--window-size='+windowSize,
        ],
        slowMo: slowMoVal,
    });
}

async function SetupPageEvents(page)
{
    page.on('console', (msg) => {
        if (msg._type == 'error'){
            console.log('PAGE LOG:', msg)
        }
    });
    page.on('response', async resp => {
        if (resp.url().includes('/main-') && resp.url().includes('.js')) {
            mainUrlHash = convertURLToFileName(await resp._url)
        }
    });
    page.on('requestfinished', async (interceptedRequest) => {
        if(interceptedRequest.resourceType() === 'script') {
            beautifiedFilePromises.push(new Promise(async (resolve) => {
                let redirectChain = interceptedRequest.redirectChain();
                if(redirectChain.length === 0) {
                let response = await interceptedRequest.response();
                const fileName = convertURLToFileName(interceptedRequest.url());
                if (fileName != mainUrlHash)
                {
                    return;
                }
                if (response !== null) {
                    let contentRequest = await response.text();

                    const scriptBeautified = beautify(contentRequest, { 
                    indent_size: 2, 
                    space_in_empty_paren: true 
                    });
                    fs.writeFile(`download/${fileName}.js`, scriptBeautified, 'utf8', (err) => {
                    if (err !== null) {
                        console.error(`Could not save the beautified file: ${err.message}`);
                    }
                    resolve();
                    });
                }
                }
            })); 
        }
    });
}

async function Login(page){
    await page.waitForNavigation()
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
    
    Login(page);

    await page.screenshot({ path: 'download/result.png' });
    await har.stop();

    await Promise.all(beautifiedFilePromises);
    await browser.close();
})();