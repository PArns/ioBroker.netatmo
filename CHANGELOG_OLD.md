# Older changes
## 2.0.5 (2022-09-16)
* (Apollon77) Catch communication errors better

## 2.0.4 (2022-09-15)
* (Apollon77) Fix crash case with Smoke detector events

## 2.0.3 (2022-09-14)
* (Apollon77) Fixes and Optimizations for Doorbell devices

## 2.0.2 (2022-09-12)
IMPORTANT: This Adapter requires Admin 6.2.14+ to be configured!
* BREAKING: Object structure changes completely and now uses unique IDs instead of names!
* (Apollon77) Change the Authentication method as requested by Netatmo till October 2022
* (Apollon77) Doorbell integration
* (Apollon77) Converted to new APIs, values of several objects might be different
* (Apollon77) Fix crash cases reported by Sentry
* (Apollon77) Adjust setAway to the current API
* (Apollon77) Added setHome function (Welcome only) to mark all or specific persons as home (requires your own API key!)
* (Apollon77) setAway and setHome now also return the result of the call as callback tzo the message
* (Apollon77) Allow to edit floodlight and monitoring-state

## 1.7.1 (2022-03-30)
* (Apollon77) Fix Event cleanup

## 1.7.0 (2022-03-24)
* IMPORTANT: js-controller 3.3.19 is needed at least!
* (Apollon77) Activate events again (manually delete objects once if you get type errors)
* (Apollon77) Adjust some roles and written data to prevent warnings in logs

## 1.6.0 (2022-03-13)
* (Apollon77) Important: In person names (Welcome) in state IDs forbidden characters are now replaces by _!!
* (Apollon77) Fix another potential crash case reported by sentry

## 1.5.1 (2022-03-09)
* (Apollon77) Fix jsonconfig for Client secret

## 1.5.0 (2022-03-08)
* (kyuka-dom) Added support for netatmo carbon monoxide sensor.
* (kyuka-dom) Added support for netatmo smoke alarm.
* (foxriver76) prevent crashes if application limit reached
* (Apollon77) Allow to specify own id/secret in all cases
* (Apollon77/foxriver76) ensure that minimum polling interval of 10 minutes is respected if no individual ID/Secret is provided
* (Apollon77) Several pother fixes and optimizations
* (Apollon77) Add Sentry for crash reporting

## 1.4.4 (2021-07-21)
* (Apollon77) Fix typo that lead to a crash

## 1.4.3 (2021-06-27)
* (Apollon77) Fix typo to fix crash

## 1.4.2 (2021-06-27)
* (bluefox) Removed warnings about the type of states

## 1.4.0 (2021-06-24)
* (bluefox) Added the support of admin5 
* (bluefox) Removed warnings about the type of states

## 1.3.3
* (PArns) removed person history

## 1.3.2
* (PArns) Updated libs & merged pending patches
* (PArns) Changed update interval from 5 to 10 minutes (requested by Netatmo)

## 1.3.1
* (PArns) Fixed event cleanup crash

## 1.3.0
* (HMeyer) Added Netatmo Coach

## 1.2.2
* (PArns) Updated meta info

## 1.2.0
* (PArns) Fixed camera picture for events
* (PArns) Added camera vignette for events
* (PArns) Added camera video for events
* (PArns) Added new sub event type (human, vehicle, animal, unknown)
* (PArns) Added LastEventID within the LastEventData section

## 1.1.7
* (PArns) Added missing lib dependencies

## 1.1.6
* (PArns) Removed GIT requirement and included netatmo lib directly

## 1.1.5
* (PArns) Removed 502 error output if API has backend problems

## 1.1.4
* (PArns) Added support for unnamed modules

## 1.1.1
* (PArns) Simplified setAway

## 1.1.0
* (PArns) Added setAway function (Welcome only) to mark all or specific persons as away (requires your own API key!)

## 1.0.1
* (PArns) Fixed scope problems for presence & welcome (requires your own API key!)

## 1.0.0
* (PArns) Added live camera picture & stream for presence & welcome
* (PArns) Fixed known & unknown face image url for presence & welcome

## 0.6.2
* (PArns) Added name of last seen known face

## 0.6.1
* (PArns) Changed realtime server to use new general realtime server
* (PArns) Changed enums to channels to avoid enum creation
* (PArns) Simplified detection for movement-, known- & unknown- face events

## 0.6.0
* (PArns) Rewritten realtime updates to not need a local server any longer! Realtime updates are now turned on by default if a Welcome or Present cam is available

## 0.5.1
* (PArns) Optimized realtime updates to avoid updates if only movement was detected

## 0.5.0
* (PArns) Added realtime events for Netatmo Welcome

## 0.4.1
* (PArns) Removed log warnings for Wind sensor

## 0.4.0
* (PArns) Added absolute humidity
* (PArns) Added dewpoint

## 0.3.1
* (PArns) Reuse of preconfigured OAuth Client data
* (PArns) Added backward compatibility with existing installations

## 0.3.0
* (wep4you) Initial implementation of Netatmo welcome camera

## 0.2.2
* (PArns) Fixed SumRain24MaxDate & SumRain24Max which won't update in some rare cases

## 0.2.1
* (PArns) Corrected DateTime values & object types

## 0.2.0
* (PArns) Added SumRain1Max/SumRain1MaxDate & SumRain24Max/SumRain24MaxDate to get overall rain max since adapter installation

## 0.1.1
* (PArns) Fixed TemperatureAbsoluteMin/TemperatureAbsoluteMax

## 0.1.0
* (PArns) Fixed CO2 calibrating status
* (PArns) Added last update for devices
* (PArns) Added TemperatureAbsoluteMin/TemperatureAbsoluteMax to get overall temperature min/max since adapter installation

## 0.0.4
* (PArns) Fixed typo/missing parameter in GustStrength

## 0.0.3
* (PArns) Added error handling to prevent exceptions for missing parameters

## 0.0.2
* (PArns) Fixed rain sensor

## 0.0.1
* (PArns) Initial release
