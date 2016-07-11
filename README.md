![Logo](admin/netatmo.png)
# ioBroker.netatmo

[![NPM version](http://img.shields.io/npm/v/iobroker.netatmo.svg)](https://www.npmjs.com/package/iobroker.netatmo)
[![Downloads](https://img.shields.io/npm/dm/iobroker.netatmo.svg)](https://www.npmjs.com/package/iobroker.netatmo)

[![NPM](https://nodei.co/npm/iobroker.netatmo.png?downloads=true)](https://nodei.co/npm/iobroker.netatmo/)

Netatmo adapter for ioBroker

## Installation
Just enter your Netatmo username & password within the adapter settings

## Changelog

### 0.3.1
* (PArns) Reuse of preconfigured OAuth Client data
* (PArns) Added backward compatibility with existing installations

### 0.3.0
* (wep4you) Initial implementation of netatmo welcome camera

### 0.2.2
* (PArns) Fixed SumRain24MaxDate & SumRain24Max which won't update in some rare cases

#### 0.2.1
* (PArns) Corrected DateTime values & object types

#### 0.2.0
* (PArns) Added SumRain1Max/SumRain1MaxDate & SumRain24Max/SumRain24MaxDate to get overall rain max since adapter installation

#### 0.1.1
* (PArns) Fixed TemperatureAbsoluteMin/TemperatureAbsoluteMax

#### 0.1.0
* (PArns) Fixed CO2 calibrating status
* (PArns) Added last update for devices
* (PArns) Added TemperatureAbsoluteMin/TemperatureAbsoluteMax to get overall temperature min/max since adapter installation

#### 0.0.4
* (PArns) Fixed typo/missing parameter in GustStrength

#### 0.0.3
* (PArns) Added error handling to prevent exceptions for missing parameters

#### 0.0.2
* (PArns) Fixed rain sensor

#### 0.0.1
* (PArns) Initial release

## License
MIT

Copyright (c) 2016 Patrick Arns <iobroker@patrick-arns.de>