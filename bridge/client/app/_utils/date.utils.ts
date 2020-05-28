import * as moment from "moment";

export default class DateUtil {
  static getDurationFormatted(start, end) {
    let diff = moment(end).diff(moment(start));
    let duration = moment.duration(diff);

    let days = Math.floor(duration.asDays());
    let hours = Math.floor(duration.asHours()%24);
    let minutes = Math.floor(duration.asMinutes()%60);
    let seconds = Math.floor(duration.asSeconds()%60);

    let result = seconds+' seconds';
    if(minutes > 1)
      result = minutes+' minutes '+result;
    if(hours > 1)
      result = hours+' hours '+result;
    if(days > 1)
      result = days+' days '+result;

    return result;
  }

  static getCalendarFormats(showSeconds?: boolean) {
    if(showSeconds) {
      return {
        lastDay : '[Yesterday at] HH:mm:ss',
        sameDay : '[Today at] HH:mm:ss',
        nextDay : '[Tomorrow at] HH:mm:ss',
        lastWeek : '[last] dddd [at] HH:mm:ss',
        nextWeek : 'dddd [at] HH:mm:ss',
        sameElse : 'YYYY-MM-DD HH:mm:ss'
      };
    }
    return {
      lastDay : '[Yesterday at] HH:mm',
      sameDay : '[Today at] HH:mm',
      nextDay : '[Tomorrow at] HH:mm',
      lastWeek : '[last] dddd [at] HH:mm',
      nextWeek : 'dddd [at] HH:mm',
      sameElse : 'YYYY-MM-DD HH:mm'
    };
  }
}
