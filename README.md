# EvenBetterEvents
An advanced event emitter for NodeJS and browsers

**2023-05-03** - Starting to restructure this project for TypeScript. The original ./better_events.js still exists and works as normal. The remainder of this README may contain stuff which isn't quite true _yet_.


## Project Structure

This project is written in typescript, but it's meant to be run from the command line using just `node`, as such the the source files (`./src/**/*.ts`) are uploaded to github and the compiled files (`./dist/**/*.js`) are published to npm.

## Installation

To use this package you only need the compiled code from npm so simply run:
```bash
npm install --production -g eventbetterevents
```

## Usage
TODO

## Development

To develop this package you need the source code from GitHub:
```bash
git clone https://github.com/plundell/eventbetterevents.git
#or
gh repo clone plundell/eventbetterevents
cd eventbetterevents
```
If you're forking the repo you should then:
```bash
gh repo create --source=. --push --public
#or
#use browser to login to github and create my-new-repo
git remote add my-foo-fork https://github.com/my-github-user/my-new-repo.git #my-foo-fork is the alias for the remote
git push -u my-foo-fork master #sets default remote and branch and pushes a copy there 

```
Now you'll need the dev dependencies:
```bash
npm install
```
After you've made any changes you want you can either:
 - use it _as is_ without compiling or uploading anywhere:
 ```bash
 npm start
 ```
 - building and publishing to npm
 ```bash
 npm run build
 npm login
 npm publish

 ```
 - pushing to github
 ```bash
 git add .
 git commit -m "clever changes"
 git push
 ```

