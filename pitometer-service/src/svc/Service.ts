import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { RequestModel } from './RequestModel';
import axios, { AxiosRequestConfig, AxiosPromise, AxiosError } from 'axios';
const { base64encode, base64decode } = require('nodejs-base64');

const Pitometer = require('@keptn/pitometer').Pitometer;
// tslint:disable-next-line: variable-name
const PrometheusSource = require('@keptn/pitometer-source-prometheus').Source;
// tslint:disable-next-line: variable-name
const DynatraceSource = require('@keptn/pitometer-source-dynatrace').Source;
// tslint:disable-next-line: variable-name
const ThresholdGrader = require('@keptn/pitometer-grader-threshold').Grader;

import moment from 'moment';

import { Logger } from '../lib/Logger';
import { Keptn } from '../lib/Keptn';
import { Credentials } from '../lib/Credentials';
import { DynatraceCredentialsModel } from '../lib/DynatraceCredentialsModel';

@injectable()
export class Service {

  constructor() { }

  public async handleRequest(event: RequestModel): Promise<boolean> {
    try {
      if (event.data.teststrategy === 'functional') {
        Logger.log(
          event.shkeptncontext, event.id,
          `No performance gate specified for stage ${event.data.stage}`,
        );
        this.handleEvaluationResult({ result: 'pass' }, event);
        return true;
      }
      const pitometer = new Pitometer();

      let prometheusUrl;
      if (process.env.NODE_ENV === 'production') {
        prometheusUrl =
          `http://prometheus-service.monitoring.svc.cluster.local:8080/api/v1/query`;
      } else {
        prometheusUrl = 'http://localhost:8080/api/v1/query';
      }

      let testRunDurationMinutes = 0;
      if (event.time !== undefined && event.data.startedat !== undefined) {
        testRunDurationMinutes = Math.ceil(
          moment.duration(moment(event.time).diff(moment(event.data.startedat))).asMinutes(),
        );
      }

      pitometer.addGrader('Threshold', new ThresholdGrader());

      // tslint:disable-next-line: max-line-length
      // const perfspecUrl = `https://raw.githubusercontent.com/${event.data.githuborg}/${event.data.service}/master/perfspec/perfspec.json`;
      const perfspecUrl = `http://configuration-service.keptn.svc.cluster.local:8080/v1/project/${event.data.project}/stage/${event.data.stage}/service/${event.data.service}/resource/perfspec.json`
      let perfspecResponse;

      try {
        perfspecResponse = await axios.get(perfspecUrl, {
        });
      } catch (e) {
        Logger.log(
          event.shkeptncontext, event.id,
          `No perfspec file defined for `
          + `${event.data.project}:${event.data.service}:${event.data.stage}`);
        this.handleEvaluationResult({ result: 'pass' }, event);
        return true;
      }

      if (perfspecResponse.data !== undefined && perfspecResponse.data.resourceContent !== undefined) {
        let perfspecString;
        let perfspec;
        // decode the base64 encoded string
        perfspecString = base64decode(perfspecResponse.data.resourceContent)

        Logger.log(
          event.shkeptncontext, event.id,
          perfspecString,
        );

        try {
          perfspec = JSON.parse(perfspecString);
        } catch (e) {
          this.handleEvaluationResult(
            {
              result: 'failed',
              error: 'Bad perfspec format.',
            },
            event,
          );
          return false;
        }

        const envPlaceHolderRegex = new RegExp('\\$ENVIRONMENT', 'g');

        /*
        /* TODO: going forward, setting the duration via the $DURATION_MINUTES
        /* placeholder will become obsolete, since this is handled by pitometer now.
        /* For backwards compatibility reasons we have to keep this for now.
        */
        const durationRegex = new RegExp('\\$DURATION_MINUTES', 'g');
        perfspecString =
          perfspecString.replace(envPlaceHolderRegex, `${event.data.project}-${event.data.stage}`);
        if (testRunDurationMinutes > 0) {
          perfspecString = perfspecString.replace(durationRegex, `${testRunDurationMinutes}`);
        } else {
          perfspecString = perfspecString.replace(durationRegex, `3`);
        }

        perfspec = JSON.parse(perfspecString);
        Logger.log(
          event.shkeptncontext, event.id,
          `Perfspec file content: ${JSON.stringify(perfspec)}`,
        );

        const indicators = [];
        if (perfspec === undefined || perfspec.indicators === undefined) {
          this.handleEvaluationResult(
            {
              result: 'failed',
              error: 'Bad perfspec format.',
            },
            event,
          );
          return false;
        }

        if (perfspec.indicators
          .find(indicator => indicator.source.toLowerCase() === 'prometheus') !== undefined) {
          this.addPrometheusSource(event, pitometer, prometheusUrl);
        }
        // get dynatrace service entity ID if Dynatrace source is defined in perfspec
        let serviceEntityId = '';
        if (perfspec.indicators
          .find(indicator => indicator.source.toLowerCase() === 'dynatrace') !== undefined) {
          try {
            const dynatraceCredentials = await this.addDynatraceSource(event, pitometer);
            serviceEntityId = await this.getDTServiceEntityId(event, dynatraceCredentials);

            if (serviceEntityId === undefined || serviceEntityId === '') {
              this.handleEvaluationResult(
                {
                  result: 'failed',
                  error: 'No Dynatrace Service Entity found.',
                },
                event,
              );
              return false;
            }
          } catch (e) {
            this.handleEvaluationResult(
              {
                result: 'failed',
                error: `Error while fetching Dynatrace data: ${e}`,
              },
              event,
            );
            return false;
          }
        }

        for (let i = 0; i < perfspec.indicators.length; i += 1) {
          const indicator = perfspec.indicators[i];
          if (indicator.source.toLowerCase() === 'dynatrace' && indicator.query !== undefined) {
            if (serviceEntityId !== undefined && serviceEntityId !== '') {
              indicator.query.entityIds = [serviceEntityId];
            }
          }
          indicators.push(indicator);
        }
        perfspec.indicators = indicators;
        try {
          const evaluationResult = await pitometer.run(
            perfspec,
            {
              timeStart: moment(event.data.startedat).unix(),
              timeEnd: moment(event.time).unix(),
            },
          );
          Logger.log(
            event.shkeptncontext, event.id,
            evaluationResult,
          );

          this.handleEvaluationResult(evaluationResult, event);
        } catch (e) {
          Logger.log(
            event.shkeptncontext,
            JSON.stringify(e.config.data),
            'ERROR',
          );
          this.handleEvaluationResult(
            {
              result: 'failed',
              error: `${e}`,
            },
            event,
          );
        }
      }
      return true;
    } catch (e) {
      this.handleEvaluationResult(
        {
          result: 'failed',
          error: `${e}`,
        },
        event,
      );
    }
  }

  private addPrometheusSource(event: RequestModel, pitometer: any, prometheusUrl: any) {
    Logger.log(event.shkeptncontext, `Adding Prometheus source`, 'DEBUG');
    pitometer.addSource('Prometheus', new PrometheusSource({
      queryUrl: prometheusUrl,
    }));
  }

  private async addDynatraceSource(
    event: RequestModel, pitometer: any): Promise<DynatraceCredentialsModel> {
    const dynatraceCredentials = await Credentials.getInstance().getDynatraceCredentials();
    if (dynatraceCredentials !== undefined &&
      dynatraceCredentials.tenant !== undefined &&
      dynatraceCredentials.apiToken !== undefined) {
      Logger.log(
        event.shkeptncontext, event.id,
        `Adding Dynatrace Source for tenant ${dynatraceCredentials.tenant}`,
        'DEBUG',
      );
      pitometer.addSource('Dynatrace', new DynatraceSource({
        baseUrl: `https://${dynatraceCredentials.tenant}`,
        apiToken: dynatraceCredentials.apiToken,
        log: console.log,
      }));

      return dynatraceCredentials;
    }
    throw new Error('no Dynatrace credentials available in the cluster.');
  }

  private async getDTServiceEntityId(
    event: RequestModel, dynatraceCredentials: DynatraceCredentialsModel) {
    try {
      let entityId = '';
      for (let i = 0; i < 10; i += 1) {
        entityId = await this.getEntityId(event, dynatraceCredentials);
        if (entityId !== '') {
          return entityId;
        }
        await this.delay(20000);
      }
      return '';
    } catch (e) {
      throw e;
    }
  }

  private delay(t) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, t);
    });
  }

  private async getEntityId(
    event: RequestModel, dynatraceCredentials: DynatraceCredentialsModel): Promise<string> {
    let entityId = '';
    Logger.log(
      event.shkeptncontext, event.id,
      `Trying to get serviceEntityId with most requests ` +
      `during test run execution for ${event.data.service} ` +
      `in namespace ${event.data.project}-${event.data.stage}`,
    );
    try {
      const dtApiUrl =
        `https://${dynatraceCredentials.tenant}` +
        `/api/v1/timeseries/com.dynatrace.builtin%3Aservice.server_side_requests?` +
        `Api-Token=${dynatraceCredentials.apiToken}`;
      const timeseries = await axios.post(dtApiUrl, {
        aggregationType: 'count',
        startTimestamp: moment(event.data.startedat).unix() * 1000,
        endTimestamp: moment(event.time).unix() * 1000,
        tags: [
          `service:${event.data.service}`,
          `environment:${event.data.project}-${event.data.stage}`,
        ],
        queryMode: 'TOTAL',
        timeseriesId: 'com.dynatrace.builtin:service.server_side_requests',
      });

      if (timeseries.data &&
        timeseries.data.result &&
        timeseries.data.result.dataPoints) {
        let max = 0;
        for (const entity in timeseries.data.result.dataPoints) {
          const dataPoint = timeseries.data.result.dataPoints[entity][0];
          if (dataPoint.length > 1 && dataPoint[1] >= max) {
            entityId = entity;
            max = dataPoint[1];
          }
        }
      }
    } catch (e) {
      if (
        e.response !== undefined &&
        e.response.status !== undefined &&
        e.response.status === 400) {
        Logger.log(
          event.shkeptncontext,
          `No data in Dynatrace available yet.`,
          'DEBUG',
        );
        return '';
      }
      Logger.log(
        event.shkeptncontext,
        `Error while requesting serviceEntityId with most
        requests during test run execution: ${e}`,
        'ERROR',
      );
      throw e;
    }
    if (entityId !== undefined && entityId !== '') {
      Logger.log(
        event.shkeptncontext, event.id,
        `Found serviceEntityId: ${entityId}`,
      );
    } else {
      Logger.log(
        event.shkeptncontext, event.id,
        'No Dynatrace serviceEntityId found.',
      );
    }
    return entityId;
  }

  async handleEvaluationResult(evaluationResult: any, sourceEvent: RequestModel): Promise<void> {
    const evaluationPassed: boolean =
      evaluationResult.result !== undefined &&
      (evaluationResult.result === 'pass' || evaluationResult.result === 'warning');

    Logger.log(sourceEvent.shkeptncontext, sourceEvent.id, `Evaluation passed: ${evaluationPassed}`);
    try {
      Logger.log(
        sourceEvent.shkeptncontext, sourceEvent.id,
        `Pitometer Result: ${JSON.stringify(evaluationResult)}`,
      );
    } catch (e) {
      Logger.log(
        sourceEvent.shkeptncontext,
        e,
        'ERROR',
      );
    }

    const event: RequestModel = new RequestModel();
    event.type = RequestModel.EVENT_TYPES.EVALUATION_DONE;
    event.source = 'pitometer-service';
    event.shkeptncontext = sourceEvent.shkeptncontext;
    event.data.githuborg = sourceEvent.data.githuborg;
    event.data.project = sourceEvent.data.project;
    event.data.teststategy = sourceEvent.data.teststategy;
    event.data.deploymentstrategy = sourceEvent.data.deploymentstrategy;
    event.data.stage = sourceEvent.data.stage;
    event.data.service = sourceEvent.data.service;
    event.data.image = sourceEvent.data.image;
    event.data.tag = sourceEvent.data.tag;
    event.data.evaluationpassed = evaluationPassed;
    event.data.evaluationdetails = evaluationResult;

    Keptn.sendEvent(event);
  }
}
