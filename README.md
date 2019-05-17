# Build An Radio Station Skill

https://medium.com/@yia333/building-radio-stations-alexa-skill-with-the-alexa-skills-kit-376fc9537047

### This is a example of radio station skill like MyTuner RadioAPP

## Usage

```
Alexa, open my radio
what are the stations
play <radio name> eg. ABC News
Alexa, stop
```

## Pre-requisites

This is a NodeJS Lambda function and skill definition to be used by [ASK CLI](https://developer.amazon.com/docs/smapi/quick-start-alexa-skills-kit-command-line-interface.html).

- [AWS account](https://aws.amazon.com) and an [Amazon developer account](https://developer.amazon.com) to create an Alexa Skill.

- Install and configure the [AWS CLI](https://aws.amazon.com/cli/)

- DynamoDB table to persist user session

## Installation

```
$ cd custom/lambda && npm install
```

## Deployment

```
ask deploy
```
